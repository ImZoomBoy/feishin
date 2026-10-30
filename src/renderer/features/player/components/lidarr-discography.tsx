import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './lidarr-discography.module.css';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useCurrentServerId, useFullScreenPlayerStore, usePlayerSong } from '/@/renderer/store';
import { Album, AlbumListSort, LibraryItem, SortOrder } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

export type GroupKey =
    | 'compilation'
    | 'ep'
    | 'library'
    | 'live'
    | 'other'
    | 'single'
    | 'soundtrack'
    | 'studio';

export interface LidarrAlbum {
    albumType?: string;
    foreignAlbumId?: string;
    id: number;
    images?: { coverType?: string; remoteUrl?: string; url?: string }[];
    monitored?: boolean;
    releaseDate?: string;
    secondaryTypes?: (string | { name?: string })[];
    statistics?: { trackFileCount?: number };
    title: string;
}

interface LidarrArtist {
    artistName: string;
    id: number;
}

const GROUP_ORDER: GroupKey[] = [
    'studio',
    'ep',
    'live',
    'compilation',
    'soundtrack',
    'single',
    'other',
    'library',
];

export interface DiscographyItem {
    group: GroupKey;
    key: string;
    libraryAlbum?: Album;
    lidarrAlbum?: LidarrAlbum;
    title: string;
    year?: number;
}

// Loose match for names and titles: "The Beatles" == "beatles", "Radio‐Aktivität" == "radio-aktivitat"
const normalize = (value?: string) =>
    (value || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/^the\s+/, '')
        .replace(/[^a-z0-9]/g, '');

const lidarrRequest = async <T,>(
    baseUrl: string,
    apiKey: string,
    path: string,
    init?: RequestInit,
): Promise<T> => {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status}`);
    return res.status === 204 ? (null as T) : res.json();
};

const groupOf = (album: LidarrAlbum): GroupKey => {
    const secondary = (album.secondaryTypes || []).map((type) =>
        (typeof type === 'string' ? type : type.name || '').toLowerCase(),
    );
    if (secondary.includes('live')) return 'live';
    if (
        secondary.some((type) =>
            ['compilation', 'dj-mix', 'mixtape/street', 'remix'].includes(type),
        )
    )
        return 'compilation';
    if (secondary.includes('soundtrack')) return 'soundtrack';
    if (secondary.length) return 'other';

    const primary = (album.albumType || '').toLowerCase();
    if (primary === 'album') return 'studio';
    if (primary === 'ep') return 'ep';
    if (primary === 'single') return 'single';
    return 'other';
};

export type RequestState = 'done' | 'error' | 'pending';

const yearOf = (date?: string) => (date ? Number(date.slice(0, 4)) || undefined : undefined);

export const DiscographyTile = ({
    isPlaying,
    item,
    onPlay,
    onRequest,
    requestState,
}: {
    isPlaying: boolean;
    item: DiscographyItem;
    onPlay: (album: Album) => void;
    onRequest: (album: LidarrAlbum) => void;
    requestState?: RequestState;
}) => {
    const { t } = useTranslation();
    const libraryCover = useItemImageUrl({
        id: item.libraryAlbum?.imageId || undefined,
        itemType: LibraryItem.ALBUM,
        type: 'itemCard',
    });
    const lidarrCover = item.lidarrAlbum?.images?.find(
        (image) => image.coverType?.toLowerCase() === 'cover',
    )?.remoteUrl;
    const cover = libraryCover || lidarrCover;
    const owned = Boolean(item.libraryAlbum);

    return (
        <div
            className={clsx(styles.tile, { [styles.missing]: !owned, [styles.playing]: isPlaying })}
            onClick={() => item.libraryAlbum && onPlay(item.libraryAlbum)}
            title={item.title}
        >
            <div className={styles.art}>
                {cover ? (
                    <img alt="" loading="lazy" src={cover} />
                ) : (
                    <div className={styles.blank} />
                )}
                {owned ? (
                    <span className={styles.playButton} />
                ) : (
                    <>
                        <span className={styles.tag}>
                            {item.lidarrAlbum?.monitored
                                ? t('page.fullscreenPlayer.discography.wanted')
                                : t('page.fullscreenPlayer.discography.missing')}
                        </span>
                        {item.lidarrAlbum && (
                            <button
                                className={styles.request}
                                disabled={requestState === 'pending' || requestState === 'done'}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRequest(item.lidarrAlbum!);
                                }}
                                type="button"
                            >
                                {requestState === 'done'
                                    ? t('page.fullscreenPlayer.discography.searching')
                                    : requestState === 'error'
                                      ? t('page.fullscreenPlayer.discography.failed')
                                      : t('page.fullscreenPlayer.discography.request')}
                            </button>
                        )}
                    </>
                )}
            </div>
            <div className={styles.title}>{item.title}</div>
            <div className={styles.year}>
                {item.year}
                {isPlaying && ` · ${t('page.fullscreenPlayer.discography.playing')}`}
            </div>
        </div>
    );
};

// The current artist's releases from Lidarr, grouped by type and matched against the
// library, plus actions to play an owned album or ask Lidarr to fetch a missing one.
export const useLidarrDiscography = () => {
    const { t } = useTranslation();
    const song = usePlayerSong();
    const serverId = useCurrentServerId();
    const player = usePlayer();
    const queryClient = useQueryClient();
    const lidarrUrl = useFullScreenPlayerStore((state) => state.lidarrUrl)?.trim();
    const lidarrApiKey = useFullScreenPlayerStore((state) => state.lidarrApiKey)?.trim();
    const isConfigured = Boolean(lidarrUrl && lidarrApiKey);
    const [requests, setRequests] = useState<Record<number, RequestState>>({});

    const artist =
        song?.albumArtists?.find((a) => normalize(a.name) !== 'variousartists') ??
        song?.artists?.[0];

    const libraryQuery = useQuery({
        ...albumQueries.list({
            query: {
                artistIds: artist ? [artist.id] : [],
                limit: -1,
                sortBy: AlbumListSort.RELEASE_DATE,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId,
        }),
        enabled: Boolean(artist?.id && serverId),
    });

    const lidarrArtistsQuery = useQuery({
        enabled: isConfigured,
        queryFn: () => lidarrRequest<LidarrArtist[]>(lidarrUrl!, lidarrApiKey!, '/artist'),
        queryKey: ['lidarr', lidarrUrl, 'artists'],
        retry: false,
        staleTime: 10 * 60 * 1000,
    });

    const lidarrArtist = useMemo(
        () =>
            lidarrArtistsQuery.data?.find(
                (a) => normalize(a.artistName) === normalize(artist?.name),
            ),
        [lidarrArtistsQuery.data, artist?.name],
    );

    const lidarrAlbumsQuery = useQuery({
        enabled: Boolean(isConfigured && lidarrArtist),
        queryFn: () =>
            lidarrRequest<LidarrAlbum[]>(
                lidarrUrl!,
                lidarrApiKey!,
                `/album?artistId=${lidarrArtist!.id}`,
            ),
        queryKey: ['lidarr', lidarrUrl, 'albums', lidarrArtist?.id],
        retry: false,
        staleTime: 2 * 60 * 1000,
    });

    const groups = useMemo(() => {
        const libraryAlbums = libraryQuery.data?.items ?? [];
        const byReleaseGroup = new Map(
            libraryAlbums.filter((a) => a.mbzReleaseGroupId).map((a) => [a.mbzReleaseGroupId!, a]),
        );
        const matched = new Set<string>();
        const lidarrAlbums = lidarrAlbumsQuery.data ?? [];

        // First match on the MusicBrainz release group, which Lidarr tags into every file
        const matches = new Map<number, Album>();
        lidarrAlbums.forEach((album) => {
            const libraryAlbum = album.foreignAlbumId && byReleaseGroup.get(album.foreignAlbumId);
            if (libraryAlbum && !matched.has(libraryAlbum.id)) {
                matches.set(album.id, libraryAlbum);
                matched.add(libraryAlbum.id);
            }
        });

        // Then fall back to the title, once per library album, preferring albums over
        // singles with the same name (e.g. the "Autobahn" single vs the album)
        const byPreference = [...lidarrAlbums].sort(
            (a, b) => Number(groupOf(a) !== 'studio') - Number(groupOf(b) !== 'studio'),
        );
        byPreference.forEach((album) => {
            if (matches.has(album.id)) return;
            const libraryAlbum = libraryAlbums.find(
                (a) => !matched.has(a.id) && normalize(a.name) === normalize(album.title),
            );
            if (libraryAlbum) {
                matches.set(album.id, libraryAlbum);
                matched.add(libraryAlbum.id);
            }
        });

        const items: DiscographyItem[] = lidarrAlbums.map((album) => ({
            group: groupOf(album),
            key: `lidarr-${album.id}`,
            libraryAlbum: matches.get(album.id),
            lidarrAlbum: album,
            title: album.title,
            year: yearOf(album.releaseDate),
        }));

        // Albums in the library that Lidarr doesn't know about (or everything, without Lidarr)
        libraryAlbums
            .filter((album) => !matched.has(album.id))
            .forEach((album) =>
                items.push({
                    group: 'library',
                    key: `library-${album.id}`,
                    libraryAlbum: album,
                    title: album.name,
                    year: album.originalYear || album.releaseYear || undefined,
                }),
            );

        items.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

        return GROUP_ORDER.map((key) => ({
            items: items.filter((item) => item.group === key),
            key,
        })).filter((group) => group.items.length);
    }, [libraryQuery.data, lidarrAlbumsQuery.data]);

    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    const owned = groups.reduce(
        (sum, group) => sum + group.items.filter((item) => item.libraryAlbum).length,
        0,
    );

    const requestMutation = useMutation({
        mutationFn: async (album: LidarrAlbum) => {
            await lidarrRequest(lidarrUrl!, lidarrApiKey!, '/album/monitor', {
                body: JSON.stringify({ albumIds: [album.id], monitored: true }),
                method: 'PUT',
            });
            await lidarrRequest(lidarrUrl!, lidarrApiKey!, '/command', {
                body: JSON.stringify({ albumIds: [album.id], name: 'AlbumSearch' }),
                method: 'POST',
            });
        },
        onError: (_error, album) => setRequests((state) => ({ ...state, [album.id]: 'error' })),
        onMutate: (album) => setRequests((state) => ({ ...state, [album.id]: 'pending' })),
        onSuccess: (_data, album) => {
            setRequests((state) => ({ ...state, [album.id]: 'done' }));
            queryClient.invalidateQueries({ queryKey: ['lidarr', lidarrUrl, 'albums'] });
        },
    });

    const playAlbum = (album: Album) =>
        player.addToQueueByFetch(serverId, [album.id], LibraryItem.ALBUM, Play.NOW);

    const isLoading =
        libraryQuery.isLoading || lidarrArtistsQuery.isLoading || lidarrAlbumsQuery.isLoading;

    let notice: null | string = null;
    if (!isConfigured) notice = t('page.fullscreenPlayer.discography.connect');
    else if (lidarrArtistsQuery.isError || lidarrAlbumsQuery.isError)
        notice = t('page.fullscreenPlayer.discography.lidarrError');
    else if (lidarrArtistsQuery.isSuccess && !lidarrArtist)
        notice = t('page.fullscreenPlayer.discography.notInLidarr', { artist: artist?.name });

    return {
        currentAlbumId: song?.albumId,
        groups,
        isLoading,
        notice,
        owned,
        playAlbum,
        request: (album: LidarrAlbum) => requestMutation.mutate(album),
        requests,
        total,
    };
};

// Full screen player tab: the artist's releases from Lidarr, grouped by type,
// with albums missing from the library greyed out and one click to request them.
export const LidarrDiscography = () => {
    const { t } = useTranslation();
    const {
        currentAlbumId,
        groups,
        isLoading,
        notice,
        owned,
        playAlbum,
        request,
        requests,
        total,
    } = useLidarrDiscography();

    return (
        <div className={styles.container}>
            <div className={styles.summary}>
                <span>
                    {isLoading
                        ? t('page.fullscreenPlayer.discography.loading')
                        : t('page.fullscreenPlayer.discography.summary', { owned, total })}
                </span>
            </div>
            {notice && <div className={styles.notice}>{notice}</div>}
            <div className={styles.scroll}>
                {!isLoading &&
                    groups.map((group) => (
                        <section className={styles.group} key={group.key}>
                            <h4>
                                <span>
                                    {t(`page.fullscreenPlayer.discography.group.${group.key}`)}
                                </span>
                                <em>
                                    {group.items.filter((item) => item.libraryAlbum).length} /{' '}
                                    {group.items.length}
                                </em>
                            </h4>
                            <div className={styles.grid}>
                                {group.items.map((item) => (
                                    <DiscographyTile
                                        isPlaying={Boolean(
                                            item.libraryAlbum &&
                                            item.libraryAlbum.id === currentAlbumId,
                                        )}
                                        item={item}
                                        key={item.key}
                                        onPlay={playAlbum}
                                        onRequest={request}
                                        requestState={
                                            item.lidarrAlbum
                                                ? requests[item.lidarrAlbum.id]
                                                : undefined
                                        }
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
            </div>
        </div>
    );
};
