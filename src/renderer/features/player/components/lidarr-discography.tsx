import { closeAllModals, openModal } from '@mantine/modals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import styles from './lidarr-discography.module.css';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import {
    fetchReleaseGroups,
    getReleaseOutsideProfile,
    LidarrAlbum,
    LidarrArtist,
    LidarrClient,
    lidarrRequest,
    MetadataProfile,
    profileAllows,
    ReleaseGroup,
    releaseGroupCover,
    restoreProfile,
    searchAlbum,
} from '/@/renderer/features/player/api/lidarr-api';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { AppRoute } from '/@/renderer/router/routes';
import {
    useCurrentServerId,
    useFullScreenPlayerStore,
    useFullScreenPlayerStoreActions,
    usePlayerSong,
} from '/@/renderer/store';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Album, AlbumListSort, LibraryItem, SortOrder } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

export type GroupKey =
    | 'compilation'
    | 'demo'
    | 'ep'
    | 'library'
    | 'live'
    | 'other'
    | 'single'
    | 'soundtrack'
    | 'studio';

const GROUP_ORDER: GroupKey[] = [
    'studio',
    'ep',
    'live',
    'demo',
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
    // Set for releases Lidarr doesn't track, found on MusicBrainz
    releaseGroup?: ReleaseGroup;
    title: string;
    year?: number;
}

export type RequestState = 'done' | 'error' | 'pending';

// Loose match for names and titles: "The Beatles" == "beatles", "Radio‐Aktivität" == "radio-aktivitat"
const normalize = (value?: string) =>
    (value || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/^the\s+/, '')
        .replace(/[^a-z0-9]/g, '');

// Shared by Lidarr albums and MusicBrainz release groups, which use the same type names
const groupOfTypes = (
    primaryType?: null | string,
    secondaryTypes: string[] = [],
): GroupKey | null => {
    const secondary = secondaryTypes.map((type) => type.toLowerCase());
    if (secondary.includes('live')) return 'live';
    if (secondary.includes('demo')) return 'demo';
    if (
        secondary.some((type) =>
            ['compilation', 'dj-mix', 'mixtape/street', 'remix'].includes(type),
        )
    )
        return 'compilation';
    if (secondary.includes('soundtrack')) return 'soundtrack';
    if (secondary.length) return null; // interviews, audiobooks, spoken word...

    const primary = (primaryType || '').toLowerCase();
    if (primary === 'album') return 'studio';
    if (primary === 'ep') return 'ep';
    if (primary === 'single') return 'single';
    return null;
};

const groupOfLidarr = (album: LidarrAlbum): GroupKey =>
    groupOfTypes(
        album.albumType,
        (album.secondaryTypes || []).map((type) =>
            typeof type === 'string' ? type : type.name || '',
        ),
    ) ?? 'other';

// Singles are left out of the MusicBrainz fill: most artists have far too many
const groupOfReleaseGroup = (group: ReleaseGroup) => {
    const key = groupOfTypes(group['primary-type'], group['secondary-types']);
    return key === 'single' ? null : key;
};

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
    onRequest: (item: DiscographyItem) => void;
    requestState?: RequestState;
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const libraryCover = useItemImageUrl({
        id: item.libraryAlbum?.imageId || undefined,
        itemType: LibraryItem.ALBUM,
        type: 'itemCard',
    });
    const lidarrCover = item.lidarrAlbum?.images?.find(
        (image) => image.coverType?.toLowerCase() === 'cover',
    )?.remoteUrl;
    const [coverFailed, setCoverFailed] = useState(false);
    const cover =
        libraryCover ||
        lidarrCover ||
        (item.releaseGroup && !coverFailed ? releaseGroupCover(item.releaseGroup.id) : undefined);
    const owned = Boolean(item.libraryAlbum);
    const outsideLidarr = !owned && !item.lidarrAlbum && Boolean(item.releaseGroup);

    const tag = outsideLidarr
        ? t('page.fullscreenPlayer.discography.notTracked')
        : item.lidarrAlbum?.monitored
          ? t('page.fullscreenPlayer.discography.wanted')
          : t('page.fullscreenPlayer.discography.missing');

    const label =
        requestState === 'pending'
            ? t('page.fullscreenPlayer.discography.adding')
            : requestState === 'done'
              ? t('page.fullscreenPlayer.discography.searching')
              : requestState === 'error'
                ? t('page.fullscreenPlayer.discography.failed')
                : outsideLidarr
                  ? t('page.fullscreenPlayer.discography.get')
                  : t('page.fullscreenPlayer.discography.request');

    return (
        <div
            className={clsx(styles.tile, {
                [styles.missing]: !owned,
                [styles.outside]: outsideLidarr,
                [styles.playing]: isPlaying,
            })}
            // Opening the album page also closes the full screen player
            onClick={() =>
                item.libraryAlbum &&
                navigate(
                    generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                        albumId: item.libraryAlbum.id,
                    }),
                )
            }
            title={item.title}
        >
            <div className={styles.art}>
                {cover ? (
                    <img alt="" loading="lazy" onError={() => setCoverFailed(true)} src={cover} />
                ) : (
                    <div className={styles.blank} />
                )}
                {owned ? (
                    <button
                        aria-label={t('player.play', { postProcess: 'sentenceCase' })}
                        className={styles.playButton}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (item.libraryAlbum) onPlay(item.libraryAlbum);
                        }}
                        type="button"
                    />
                ) : (
                    <>
                        <span className={styles.tag}>{tag}</span>
                        {(item.lidarrAlbum || item.releaseGroup) && (
                            <button
                                className={styles.request}
                                disabled={requestState === 'pending' || requestState === 'done'}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRequest(item);
                                }}
                                type="button"
                            >
                                {label}
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

const groupLabel = (t: (key: string) => string, key: GroupKey) =>
    t(`page.fullscreenPlayer.discography.typePlural.${key}`);

// The current artist's releases from Lidarr and MusicBrainz, grouped by type and matched
// against the library, plus actions to play an owned album or have Lidarr fetch one.
export const useLidarrDiscography = () => {
    const { t } = useTranslation();
    const song = usePlayerSong();
    const serverId = useCurrentServerId();
    const player = usePlayer();
    const queryClient = useQueryClient();
    const { setStore } = useFullScreenPlayerStoreActions();
    const lidarrUrl = useFullScreenPlayerStore((state) => state.lidarrUrl)?.trim();
    const lidarrApiKey = useFullScreenPlayerStore((state) => state.lidarrApiKey)?.trim();
    const lidarrRestore = useFullScreenPlayerStore((state) => state.lidarrRestore);
    const client: LidarrClient | undefined =
        lidarrUrl && lidarrApiKey ? { apiKey: lidarrApiKey, url: lidarrUrl } : undefined;
    const [requests, setRequests] = useState<Record<string, RequestState>>({});

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
        enabled: Boolean(client),
        queryFn: () => lidarrRequest<LidarrArtist[]>(client!, '/artist'),
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
        enabled: Boolean(client && lidarrArtist),
        queryFn: () => lidarrRequest<LidarrAlbum[]>(client!, `/album?artistId=${lidarrArtist!.id}`),
        queryKey: ['lidarr', lidarrUrl, 'albums', lidarrArtist?.id],
        retry: false,
        staleTime: 2 * 60 * 1000,
    });

    const profilesQuery = useQuery({
        enabled: Boolean(client),
        queryFn: () => lidarrRequest<MetadataProfile[]>(client!, '/metadataprofile'),
        queryKey: ['lidarr', lidarrUrl, 'metadataprofiles'],
        retry: false,
        staleTime: 10 * 60 * 1000,
    });

    // Everything else the artist released, to show what Lidarr isn't tracking
    const artistMbid = lidarrArtist?.foreignArtistId;
    const releaseGroupsQuery = useQuery({
        enabled: Boolean(artistMbid),
        gcTime: Infinity,
        queryFn: () => fetchReleaseGroups(artistMbid!),
        queryKey: ['musicbrainz', 'release-groups', artistMbid],
        retry: 1,
        staleTime: 24 * 60 * 60 * 1000,
    });

    const currentProfile = profilesQuery.data?.find(
        (profile) => profile.id === lidarrArtist?.metadataProfileId,
    );

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
            (a, b) => Number(groupOfLidarr(a) !== 'studio') - Number(groupOfLidarr(b) !== 'studio'),
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
            group: groupOfLidarr(album),
            key: `lidarr-${album.id}`,
            libraryAlbum: matches.get(album.id),
            lidarrAlbum: album,
            title: album.title,
            year: yearOf(album.releaseDate),
        }));

        // Releases Lidarr isn't tracking
        const inLidarr = new Set(lidarrAlbums.map((album) => album.foreignAlbumId));
        const notInLidarr = (releaseGroupsQuery.data ?? []).filter(
            (group) => !inLidarr.has(group.id) && groupOfReleaseGroup(group),
        );
        // Only offer the ones the artist's profile leaves out, e.g. live albums. If the
        // profile already allows a release's type, Lidarr skipped it on purpose (usually
        // a bootleg or other unofficial release), and no profile switch would add it.
        const outside = currentProfile
            ? notInLidarr.filter((group) => !profileAllows(currentProfile, group))
            : [];
        const used = new Set<string>();

        // Library albums Lidarr doesn't know about go in their MusicBrainz group if possible
        libraryAlbums
            .filter((album) => !matched.has(album.id))
            .forEach((album) => {
                const group =
                    notInLidarr.find((g) => !used.has(g.id) && g.id === album.mbzReleaseGroupId) ??
                    notInLidarr.find(
                        (g) => !used.has(g.id) && normalize(g.title) === normalize(album.name),
                    );
                if (group) used.add(group.id);
                items.push({
                    group: (group && groupOfReleaseGroup(group)) || 'library',
                    key: `library-${album.id}`,
                    libraryAlbum: album,
                    title: album.name,
                    year: album.originalYear || album.releaseYear || undefined,
                });
            });

        outside
            .filter((group) => !used.has(group.id))
            .forEach((group) =>
                items.push({
                    group: groupOfReleaseGroup(group)!,
                    key: `mb-${group.id}`,
                    releaseGroup: group,
                    title: group.title,
                    year: yearOf(group['first-release-date']),
                }),
            );

        items.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

        return GROUP_ORDER.map((key) => ({
            items: items.filter((item) => item.group === key),
            key,
        })).filter((group) => group.items.length);
    }, [currentProfile, libraryQuery.data, lidarrAlbumsQuery.data, releaseGroupsQuery.data]);

    const total = groups.reduce((sum, group) => sum + group.items.length, 0);
    const owned = groups.reduce(
        (sum, group) => sum + group.items.filter((item) => item.libraryAlbum).length,
        0,
    );

    const restoreKey = lidarrArtist ? `${lidarrUrl}|${lidarrArtist.id}` : undefined;
    const restore = restoreKey ? lidarrRestore?.[restoreKey] : undefined;
    const restoreProfileName = profilesQuery.data?.find((p) => p.id === restore?.profileId)?.name;

    const refreshLidarr = () => {
        queryClient.invalidateQueries({ queryKey: ['lidarr', lidarrUrl] });
    };

    const setRequestState = (key: string, state: RequestState) =>
        setRequests((current) => ({ ...current, [key]: state }));

    const requestMutation = useMutation({
        mutationFn: async (item: DiscographyItem) => {
            if (item.lidarrAlbum) return searchAlbum(client!, item.lidarrAlbum.id);
            return getReleaseOutsideProfile({
                artistId: lidarrArtist!.id,
                client: client!,
                group: item.releaseGroup!,
                onSwitchProfile: (value) => {
                    // Keep the very first profile, if Feishin switches the artist more than once
                    const all = useFullScreenPlayerStore.getState().lidarrRestore ?? {};
                    if (!all[restoreKey!])
                        setStore({ lidarrRestore: { ...all, [restoreKey!]: value } });
                },
            });
        },
        onError: (error, item) => {
            setRequestState(item.key, 'error');
            toast.error({
                message: (error as Error).message,
                title: t('page.fullscreenPlayer.discography.failed'),
            });
            refreshLidarr();
        },
        onMutate: (item) => setRequestState(item.key, 'pending'),
        onSuccess: (_data, item) => {
            setRequestState(item.key, 'done');
            refreshLidarr();
        },
    });

    const restoreMutation = useMutation({
        mutationFn: () => restoreProfile(client!, lidarrArtist!.id, restore!),
        onError: (error) =>
            toast.error({
                message: (error as Error).message,
                title: t('page.fullscreenPlayer.discography.failed'),
            }),
        onSuccess: () => {
            const rest = { ...useFullScreenPlayerStore.getState().lidarrRestore };
            delete rest[restoreKey!];
            setStore({ lidarrRestore: rest });
            refreshLidarr();
        },
    });

    const request = (item: DiscographyItem) => {
        if (!client || !lidarrArtist) return;
        if (item.lidarrAlbum) {
            requestMutation.mutate(item);
            return;
        }

        // A release outside the artist's profile changes their Lidarr settings, so ask first
        openModal({
            children: (
                <ConfirmModal
                    labels={{
                        cancel: t('common.cancel'),
                        confirm: t('page.fullscreenPlayer.discography.get'),
                    }}
                    onConfirm={() => {
                        closeAllModals();
                        requestMutation.mutate(item);
                    }}
                >
                    <Text>
                        {t('page.fullscreenPlayer.discography.getConfirm', {
                            artist: lidarrArtist.artistName,
                            type: groupLabel(t, item.group),
                        })}
                    </Text>
                </ConfirmModal>
            ),
            title: t('page.fullscreenPlayer.discography.getTitle', { title: item.title }),
        });
    };

    const undoExtras = () => {
        if (!restore || !lidarrArtist) return;
        openModal({
            children: (
                <ConfirmModal
                    labels={{
                        cancel: t('common.cancel'),
                        confirm: t('common.confirm'),
                    }}
                    onConfirm={() => {
                        closeAllModals();
                        restoreMutation.mutate();
                    }}
                >
                    <Text>
                        {t('page.fullscreenPlayer.discography.restoreConfirm', {
                            artist: lidarrArtist.artistName,
                            profile: restoreProfileName ?? '',
                        })}
                    </Text>
                </ConfirmModal>
            ),
            title: t('page.fullscreenPlayer.discography.restoreTitle'),
        });
    };

    const playAlbum = (album: Album) =>
        player.addToQueueByFetch(serverId, [album.id], LibraryItem.ALBUM, Play.NOW);

    const isLoading =
        libraryQuery.isLoading || lidarrArtistsQuery.isLoading || lidarrAlbumsQuery.isLoading;

    let notice: null | string = null;
    if (!client) notice = t('page.fullscreenPlayer.discography.connect');
    else if (lidarrArtistsQuery.isError || lidarrAlbumsQuery.isError)
        notice = t('page.fullscreenPlayer.discography.lidarrError');
    else if (lidarrArtistsQuery.isSuccess && !lidarrArtist)
        notice = t('page.fullscreenPlayer.discography.notInLidarr', { artist: artist?.name });

    return {
        currentAlbumId: song?.albumId,
        groups,
        isLoading,
        isRestoring: restoreMutation.isPending,
        notice,
        owned,
        playAlbum,
        request,
        requests,
        // Set when Feishin moved this artist to a broader profile, to offer going back
        restoreProfileName: restore ? restoreProfileName || '…' : undefined,
        total,
        undoExtras,
    };
};

// Full screen player tab: the artist's releases grouped by type, with albums missing
// from the library greyed out and one click to have Lidarr fetch them.
export const LidarrDiscography = () => {
    const { t } = useTranslation();
    const {
        currentAlbumId,
        groups,
        isLoading,
        isRestoring,
        notice,
        owned,
        playAlbum,
        request,
        requests,
        restoreProfileName,
        total,
        undoExtras,
    } = useLidarrDiscography();

    return (
        <div className={styles.container}>
            <div className={styles.summary}>
                <span>
                    {isLoading
                        ? t('page.fullscreenPlayer.discography.loading')
                        : t('page.fullscreenPlayer.discography.summary', { owned, total })}
                </span>
                {restoreProfileName && (
                    <button
                        className={styles.restore}
                        disabled={isRestoring}
                        onClick={undoExtras}
                        type="button"
                    >
                        {t('page.fullscreenPlayer.discography.restore', {
                            profile: restoreProfileName,
                        })}
                    </button>
                )}
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
                                        requestState={requests[item.key]}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
            </div>
        </div>
    );
};
