import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { CSSProperties, ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './full-screen-layouts.module.css';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import {
    ArtistBackdrop,
    useArtistInfo,
} from '/@/renderer/features/player/components/artist-backdrop';
import { FullScreenPlayerQueue } from '/@/renderer/features/player/components/full-screen-player-queue';
import {
    DiscographyTile,
    GroupKey,
    useLidarrDiscography,
} from '/@/renderer/features/player/components/lidarr-discography';
import { useFastAverageColor } from '/@/renderer/hooks';
import { HotkeyItem, useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import {
    FULL_SCREEN_LAYOUTS,
    FullScreenPlayerLayout,
    useFullScreenPlayerStore,
    useFullScreenPlayerStoreActions,
    usePlaybackSettings,
    usePlayerSong,
} from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

const isPanelTab = (activeTab: string, webAudio: boolean) =>
    ['discography', 'lyrics', 'queue', 'related'].includes(activeTab) ||
    (activeTab === 'visualizer' && webAudio);

// The little the layouts show about the current song: the photo and cover do the talking
const useNowPlaying = () => {
    const song = usePlayerSong();
    const cover = useItemImageUrl({
        id: song?.imageId || undefined,
        itemType: LibraryItem.SONG,
        serverId: song?._serverId,
        type: 'fullScreenPlayer',
    });

    return {
        album: song?.album || undefined,
        artist: song?.artists?.map((a) => a.name).join(', ') || song?.albumArtists?.[0]?.name,
        cover,
        mainArtist: song?.artists?.[0]?.name || song?.albumArtists?.[0]?.name,
        title: song?.name,
        year: song?.releaseYear || undefined,
    };
};

const Cover = ({ className, src }: { className?: string; src?: string }) => (
    <div className={clsx(styles.cover, className)}>
        <AnimatePresence initial={false}>
            {src && (
                <motion.img
                    alt=""
                    animate={{ opacity: 1 }}
                    draggable={false}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key={src}
                    src={src}
                    transition={{ duration: 0.5 }}
                />
            )}
        </AnimatePresence>
    </div>
);

// Blurred cover behind everything, so a layout never shows a blank page
// while artist photos load (or when an artist has none)
const CoverWash = ({ src }: { src?: string }) =>
    src ? <div className={styles.wash} style={{ backgroundImage: `url("${src}")` }} /> : null;

const joinDot = (...parts: (number | string | undefined)[]) => parts.filter(Boolean).join(' · ');

// Title, then one quiet line with the artist and album
const SongText = ({
    className,
    np,
}: {
    className?: string;
    np: ReturnType<typeof useNowPlaying>;
}) => (
    <div className={clsx(styles.songText, className)}>
        <h1>{np.title}</h1>
        <div>{joinDot(np.artist, np.album)}</div>
    </div>
);

// 1. Cinema: full bleed photo, the song set like a film title in the corner
const CinemaLayout = () => {
    const np = useNowPlaying();
    return (
        <>
            <CoverWash src={np.cover} />
            <ArtistBackdrop className={styles.photo} />
            <div className={styles.cinemaShade} />
            <div className={styles.cinemaInfo}>
                <Cover className={styles.cinemaCover} src={np.cover} />
                <SongText className={styles.cinemaText} np={np} />
            </div>
        </>
    );
};

// 2. Editorial: the photo as a framed print, the cover beside it
const EditorialLayout = () => {
    const np = useNowPlaying();
    return (
        <>
            <div className={styles.editorialGlow} />
            <div className={styles.editorialPhoto}>
                <ArtistBackdrop className={styles.photo} />
            </div>
            <div className={styles.editorialMeta}>
                <Cover className={styles.editorialCover} src={np.cover} />
                <SongText className={styles.editorialText} np={np} />
            </div>
        </>
    );
};

// 3. Classic, refined: Feishin's centred cover, over the artist photo
const RefinedLayout = () => {
    const np = useNowPlaying();
    const info = useArtistInfo();
    return (
        <>
            <CoverWash src={np.cover} />
            <ArtistBackdrop className={styles.photo} />
            <div className={styles.refinedDim} />
            {info.logo && <img alt="" className={styles.refinedLogo} src={info.logo} />}
            <div className={styles.refinedColumn}>
                <Cover className={styles.refinedCover} src={np.cover} />
                <SongText className={styles.refinedText} np={np} />
            </div>
        </>
    );
};

// 4. Poster: duotone photo tinted by the cover, with the artist's name as a graphic
const PosterLayout = () => {
    const np = useNowPlaying();
    const { background } = useFastAverageColor({
        algorithm: 'dominant',
        src: np.cover,
        srcLoaded: true,
    });

    return (
        <>
            <ArtistBackdrop className={clsx(styles.photo, styles.posterPhoto)} />
            <div className={styles.posterTint} style={{ background: background || undefined }} />
            <div className={styles.posterFade} />
            <div className={styles.posterWord}>{np.mainArtist}</div>
            <div className={styles.posterWrap}>
                <div className={styles.posterDisc}>
                    <Cover className={styles.posterCover} src={np.cover} />
                </div>
                <div className={styles.posterText}>
                    <h1 className={styles.posterTitle}>{np.title}</h1>
                    <div className={styles.posterArtist}>{np.artist}</div>
                </div>
            </div>
        </>
    );
};

const DiscographyStrip = () => {
    const { t } = useTranslation();
    const { setStore } = useFullScreenPlayerStoreActions();
    const { currentAlbumId, groups, notice, playAlbum, request, requests } = useLidarrDiscography();
    const [picked, setPicked] = useState<GroupKey>();

    // Open on the group holding the album that's playing
    const fallback =
        groups.find((g) => g.items.some((i) => i.libraryAlbum?.id === currentAlbumId))?.key ??
        groups[0]?.key;
    const activeKey = groups.some((g) => g.key === picked) ? picked : fallback;
    const active = groups.find((g) => g.key === activeKey);

    return (
        <div className={styles.disco}>
            <div className={styles.discoHead}>
                <div className={styles.discoTabs}>
                    {groups.map((group) => (
                        <button
                            className={clsx({ [styles.on]: group.key === activeKey })}
                            key={group.key}
                            onClick={() => setPicked(group.key)}
                            type="button"
                        >
                            {t(`page.fullscreenPlayer.discography.group.${group.key}`)}
                            <em>
                                {group.items.filter((item) => item.libraryAlbum).length}/
                                {group.items.length}
                            </em>
                        </button>
                    ))}
                </div>
                <button
                    className={styles.discoAll}
                    onClick={() => setStore({ activeTab: 'discography' })}
                    type="button"
                >
                    {t('page.fullscreenPlayer.layout.seeAll')}
                </button>
            </div>
            {notice && <div className={styles.discoNotice}>{notice}</div>}
            <div
                className={styles.discoStrip}
                onWheel={(event) => {
                    if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
                        event.currentTarget.scrollLeft += event.deltaY;
                }}
            >
                {active?.items.map((item) => (
                    <div className={styles.discoItem} key={item.key}>
                        <DiscographyTile
                            isPlaying={Boolean(
                                item.libraryAlbum && item.libraryAlbum.id === currentAlbumId,
                            )}
                            item={item}
                            onPlay={playAlbum}
                            onRequest={request}
                            requestState={requests[item.key]}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

// 5. Artist stage: the artist is the page, with their discography along the bottom
const StageLayout = () => {
    const np = useNowPlaying();
    const info = useArtistInfo();
    return (
        <>
            <div className={styles.stageHero}>
                <CoverWash src={np.cover} />
                <ArtistBackdrop className={styles.photo} position="center 30%" />
                <div className={styles.stageShade} />
            </div>
            {info.logo && <img alt={np.artist} className={styles.stageLogo} src={info.logo} />}
            <div className={styles.stageNow}>
                <Cover className={styles.stageCover} src={np.cover} />
                <SongText className={styles.stageText} np={np} />
            </div>
            <DiscographyStrip />
        </>
    );
};

const LAYOUT_VIEWS: Record<Exclude<FullScreenPlayerLayout, 'classic'>, () => ReactNode> = {
    cinema: CinemaLayout,
    editorial: EditorialLayout,
    poster: PosterLayout,
    refined: RefinedLayout,
    stage: StageLayout,
};

export const FullScreenLayoutView = ({
    layout,
}: {
    layout: Exclude<FullScreenPlayerLayout, 'classic'>;
}) => {
    const activeTab = useFullScreenPlayerStore((state) => state.activeTab);
    const { webAudio } = usePlaybackSettings();
    const isOpen = isPanelTab(activeTab, webAudio);
    const View = LAYOUT_VIEWS[layout];

    return (
        <div className={clsx(styles.root, styles[layout], { [styles.open]: isOpen })}>
            <AnimatePresence initial={false} mode="wait">
                <motion.div
                    animate={{ opacity: 1 }}
                    className={styles.layer}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key={layout}
                    transition={{ duration: 0.25 }}
                >
                    <View />
                </motion.div>
            </AnimatePresence>
            <FullScreenPlayerQueue className={styles.panel} />
        </div>
    );
};

// Pills along the top to switch layouts on the fly (also number keys)
export const FullScreenLayoutSwitcher = () => {
    const { t } = useTranslation();
    const layout = useFullScreenPlayerStore((state) => state.layout) ?? 'classic';
    const { setStore } = useFullScreenPlayerStoreActions();

    const hotkeys = useMemo(
        () =>
            FULL_SCREEN_LAYOUTS.map(
                (key, index): HotkeyItem => [String(index + 1), () => setStore({ layout: key })],
            ),
        [setStore],
    );
    useHotkeys(hotkeys);

    return (
        <div
            className={clsx(styles.switcher, 'full-screen-player-controls-container')}
            style={{ '--count': FULL_SCREEN_LAYOUTS.length } as CSSProperties}
        >
            {FULL_SCREEN_LAYOUTS.map((key, index) => (
                <button
                    className={clsx({ [styles.on]: key === layout })}
                    key={key}
                    onClick={() => setStore({ layout: key })}
                    title={`${index + 1}`}
                    type="button"
                >
                    {t(`page.fullscreenPlayer.layout.${key}`)}
                </button>
            ))}
        </div>
    );
};
