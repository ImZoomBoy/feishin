import { useQueries, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { useFullScreenPlayerStore, usePlayerSong } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

const ROTATE_INTERVAL_MS = 12000;

// TheAudioDB's public test key. Fanart fields are 1280x720 backdrops.
const AUDIODB_URL = 'https://www.theaudiodb.com/api/v1/json/123/search.php?s=';
const AUDIODB_FANART_FIELDS = [
    'strArtistFanart',
    'strArtistFanart2',
    'strArtistFanart3',
    'strArtistFanart4',
] as const;

// fanart.tv artist backgrounds are 1920x1080 and need a (free) personal API key.
const FANART_TV_URL = 'https://webservice.fanart.tv/v3/music/';

export interface ArtistInfo {
    country?: string;
    formed?: string;
    genre?: string;
    // Transparent PNG of the artist's logo, when one exists
    logo?: string;
}

interface ArtistPhotos {
    // Sharp 16:9 photos, best first
    backdrops: string[];
    // Lower resolution photos, only used when there are no backdrops
    fallbacks: string[];
    info: ArtistInfo;
}

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const fetchJson = async (url: string) => {
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
};

const fetchArtistPhotos = async (name: string, fanartApiKey?: string): Promise<ArtistPhotos> => {
    const artist = (await fetchJson(AUDIODB_URL + encodeURIComponent(name)))?.artists?.[0];
    if (!artist) return { backdrops: [], fallbacks: [], info: {} };

    const audioDbFanart: string[] = AUDIODB_FANART_FIELDS.map((field) => artist[field]).filter(
        Boolean,
    );

    let fanartTv: string[] = [];
    let fanartLogo: string | undefined;
    if (fanartApiKey && artist.strMusicBrainzID) {
        const data = await fetchJson(
            `${FANART_TV_URL}${artist.strMusicBrainzID}?api_key=${encodeURIComponent(fanartApiKey)}`,
        );
        fanartTv = (data?.artistbackground ?? []).map((image: { url: string }) => image.url);
        fanartLogo = data?.hdmusiclogo?.[0]?.url ?? data?.musiclogo?.[0]?.url;
    }

    const backdrops = [...shuffle(fanartTv), ...shuffle(audioDbFanart)];
    // The wide thumb is also 16:9 but smaller (1000x562), so only add it for variety
    if (backdrops.length < 3 && artist.strArtistWideThumb)
        backdrops.push(artist.strArtistWideThumb);

    return {
        backdrops,
        fallbacks: [artist.strArtistThumb].filter(Boolean),
        info: {
            country: artist.strCountry || undefined,
            formed: artist.intFormedYear || undefined,
            genre: artist.strGenre || artist.strStyle || undefined,
            logo: fanartLogo || artist.strArtistLogo || undefined,
        },
    };
};

const artistPhotosQuery = (name: string, fanartApiKey?: string) => ({
    gcTime: Infinity,
    queryFn: () => fetchArtistPhotos(name, fanartApiKey),
    queryKey: ['artist-photos', name, Boolean(fanartApiKey)],
    retry: false,
    staleTime: Infinity,
});

// Song artists first (the performers), then the album artist, e.g. for compilations
const useSongArtists = () => {
    const song = usePlayerSong();
    return useMemo(() => {
        const all = [...(song?.artists ?? []), ...(song?.albumArtists ?? [])];
        return all.filter((a, i) => a.name && all.findIndex((b) => b.name === a.name) === i);
    }, [song?.artists, song?.albumArtists]);
};

// Logo and facts (formed, country, genre) for an artist
export const useArtistInfoFor = (name?: string): ArtistInfo => {
    const fanartApiKey = useFullScreenPlayerStore((state) => state.fanartApiKey)?.trim();
    const { data } = useQuery({
        ...artistPhotosQuery(name ?? '', fanartApiKey),
        enabled: Boolean(name),
    });
    return data?.info ?? {};
};

// The same, for the current song's main artist
export const useArtistInfo = (): ArtistInfo => useArtistInfoFor(useSongArtists()[0]?.name);

export interface BackdropArtist {
    id: string;
    imageId?: null | string;
    imageUrl?: null | string;
    name: string;
}

const preload = (url: string) =>
    new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
    });

// Background that rotates through photos of the given artists (by default the current
// song's). Falls back to the artist image from the music server.
export const ArtistBackdrop = ({
    artists: artistsProp,
    className,
    position = 'center 25%',
}: {
    artists?: BackdropArtist[];
    className: string;
    position?: string;
}) => {
    const fanartApiKey = useFullScreenPlayerStore((state) => state.fanartApiKey)?.trim();
    const songArtists = useSongArtists();
    const artists = artistsProp ?? songArtists;

    const primary = artists[0];

    const serverImageUrl = useItemImageUrl({
        id: primary ? primary.imageId || primary.id : undefined,
        imageUrl: primary?.imageUrl,
        itemType: LibraryItem.ARTIST,
        size: 1500,
    });

    const results = useQueries({
        queries: artists.slice(0, 3).map((artist) => artistPhotosQuery(artist.name, fanartApiKey)),
    });

    const photoKey = results.map((r) => r.dataUpdatedAt).join();

    const images = useMemo(() => {
        const sets = results.map((r) => r.data).filter(Boolean) as ArtistPhotos[];
        // Prefer the main artist, but add other artists' photos for variety
        const backdrops = sets.flatMap((set) => set.backdrops);
        if (backdrops.length) return [...new Set(backdrops)];
        if (serverImageUrl) return [serverImageUrl];
        return [...new Set(sets.flatMap((set) => set.fallbacks))].slice(0, 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [photoKey, serverImageUrl]);

    const [index, setIndex] = useState(0);
    const [url, setUrl] = useState<string>();

    // Start from the first photo whenever the photo list changes (e.g. new artist)
    useEffect(() => setIndex(0), [images]);

    useEffect(() => {
        if (images.length < 2) return undefined;
        const timer = setInterval(() => setIndex((value) => value + 1), ROTATE_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [images]);

    // Only swap once the next photo has loaded, so it never fades into a blank frame
    useEffect(() => {
        const next = images.length ? images[index % images.length] : undefined;
        if (!next) {
            setUrl(undefined);
            return undefined;
        }

        let cancelled = false;
        preload(next).then(() => {
            if (!cancelled) setUrl(next);
        });

        // Warm up the photo after this one
        if (images.length > 1) preload(images[(index + 1) % images.length]);

        return () => {
            cancelled = true;
        };
    }, [images, index]);

    return (
        <AnimatePresence initial={false}>
            {url && (
                <motion.div
                    animate={{ opacity: 1 }}
                    className={className}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key={url}
                    style={{ backgroundImage: `url("${url}")`, backgroundPosition: position }}
                    transition={{ duration: 1.5, ease: 'linear' }}
                />
            )}
        </AnimatePresence>
    );
};
