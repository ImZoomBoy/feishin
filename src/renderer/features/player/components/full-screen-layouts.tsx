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

// Everything the layouts show about the current song
const useNowPlaying = () => {
    const song = usePlayerSong();
    const cover = useItemImageUrl({
        id: song?.imageId || undefined,
        itemType: LibraryItem.SONG,
        serverId: song?._serverId,
        type: 'fullScreenPlayer',
    });

    const artist = song?.artists?.map((a) => a.name).join(', ') || song?.albumArtists?.[0]?.name;
    const chips = [
        song?.container?.toUpperCase(),
        song?.bitRate ? `${song.bitRate} kbps` : undefined,
        song?.sampleRate ? `${song.sampleRate / 1000} kHz` : undefined,
        song?.genres?.[0]?.name,
    ].filter(Boolean) as string[];

    return {
        album: song?.album || undefined,
        artist,
        chips,
        cover,
        song,
        title: song?.name,
        track: song?.trackNumber || undefined,
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

const Chips = ({ chips }: { chips: string[] }) =>
    chips.length ? (
        <div className={styles.chips}>
            {chips.map((chip) => (
                <span key={chip}>{chip}</span>
            ))}
        </div>
    ) : null;

// Blurred cover behind everything, so a layout never shows a blank page
// while artist photos load (or when an artist has none)
const CoverWash = ({ src }: { src?: string }) =>
    src ? <div className={styles.wash} style={{ backgroundImage: `url("${src}")` }} /> : null;

const joinDot = (...parts: (number | string | undefined)[]) => parts.filter(Boolean).join(' · ');

// 1. Cinema: full bleed photo, the song set like a film title in the corner
const CinemaLayout = () => {
    const { t } = useTranslation();
    const np = useNowPlaying();
    return (
        <>
            <CoverWash src={np.cover} />
            <ArtistBackdrop className={styles.photo} />
            <div className={styles.cinemaShade} />
            <div className={styles.cinemaInfo}>
                <Cover className={styles.cinemaCover} src={np.cover} />
                <div className={styles.cinemaText}>
                    <div className={styles.eyebrow}>
                        {joinDot(
                            t('page.fullscreenPlayer.layout.nowPlaying'),
                            np.track &&
                                t('page.fullscreenPlayer.layout.track', { number: np.track }),
                        )}
                    </div>
                    <h1 className={styles.cinemaTitle}>{np.title}</h1>
                    <div className={styles.cinemaArtist}>{np.artist}</div>
                    <div className={styles.cinemaAlbum}>{joinDot(np.album, np.year)}</div>
                    <Chips chips={np.chips} />
                </div>
            </div>
        </>
    );
};

// 2. Editorial: the photo as a framed print, cover and details beside it
const EditorialLayout = () => {
    const { t } = useTranslation();
    const np = useNowPlaying();
    const info = useArtistInfo();
    const facts = [
        [t('page.fullscreenPlayer.layout.format'), joinDot(np.chips[0], np.chips[1])],
        [t('page.fullscreenPlayer.layout.genre'), np.song?.genres?.[0]?.name || info.genre],
        [t('page.fullscreenPlayer.layout.year'), np.year],
    ].filter(([, value]) => value);

    return (
        <>
            <div className={styles.editorialGlow} />
            <div className={styles.editorialPhoto}>
                <ArtistBackdrop className={styles.photo} />
                <div className={styles.editorialCaption}>
                    <b>{np.artist}</b>
                    {info.country && <span>{info.country}</span>}
                </div>
            </div>
            <div className={styles.editorialMeta}>
                <Cover className={styles.editorialCover} src={np.cover} />
                <div className={styles.kicker}>{t('page.fullscreenPlayer.layout.nowPlaying')}</div>
                <h1 className={styles.editorialTitle}>{np.title}</h1>
                <div className={styles.editorialArtist}>{np.artist}</div>
                <div className={styles.editorialAlbum}>
                    {joinDot(
                        np.album,
                        np.track && t('page.fullscreenPlayer.layout.track', { number: np.track }),
                    )}
                </div>
                {facts.length > 0 && (
                    <div className={styles.facts}>
                        {facts.map(([label, value]) => (
                            <div key={label as string}>
                                {label}
                                <b>{value}</b>
                            </div>
                        ))}
                    </div>
                )}
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
                <h1 className={styles.refinedTitle}>{np.title}</h1>
                <div className={styles.refinedArtist}>{np.artist}</div>
                <div className={styles.refinedAlbum}>{joinDot(np.album, np.year)}</div>
            </div>
        </>
    );
};

// 4. Poster: duotone photo tinted by the cover, big type and a spinning record
const PosterLayout = () => {
    const np = useNowPlaying();
    const { background } = useFastAverageColor({
        algorithm: 'dominant',
        src: np.cover,
        srcLoaded: true,
    });
    const number = [np.track && String(np.track).padStart(2, '0'), np.year]
        .filter(Boolean)
        .join('  —  ');

    return (
        <>
            <ArtistBackdrop className={clsx(styles.photo, styles.posterPhoto)} />
            <div className={styles.posterTint} style={{ background: background || undefined }} />
            <div className={styles.posterFade} />
            <div className={styles.posterWord}>{np.song?.artists?.[0]?.name || np.artist}</div>
            <div className={styles.posterWrap}>
                <div className={styles.posterDisc}>
                    <div className={styles.vinyl}>
                        {np.cover && (
                            <div
                                className={styles.vinylLabel}
                                style={{ backgroundImage: `url("${np.cover}")` }}
                            />
                        )}
                    </div>
                    <Cover className={styles.posterCover} src={np.cover} />
                </div>
                <div className={styles.posterText}>
                    {number && <div className={styles.posterNumber}>{number}</div>}
                    <h1 className={styles.posterTitle}>{np.title}</h1>
                    <div className={styles.posterArtist}>{np.artist}</div>
                    <div className={styles.posterAlbum}>{np.album}</div>
                </div>
            </div>
        </>
    );
};

const DiscographyStrip = () => {
    const { t } = useTranslation();
    const { setStore } = useFullScreenPlayerStoreActions();
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
                <span className={styles.discoLabel}>
                    {t('page.fullscreenPlayer.discography.tab')}
                </span>
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
                <span className={styles.discoSummary}>
                    {isLoading
                        ? t('page.fullscreenPlayer.discography.loading')
                        : t('page.fullscreenPlayer.discography.summary', { owned, total })}
                </span>
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
                            requestState={
                                item.lidarrAlbum ? requests[item.lidarrAlbum.id] : undefined
                            }
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

// 5. Artist stage: the artist is the page, with their discography along the bottom
const StageLayout = () => {
    const { t } = useTranslation();
    const np = useNowPlaying();
    const info = useArtistInfo();
    const about = [
        [t('page.fullscreenPlayer.layout.formed'), info.formed],
        [t('page.fullscreenPlayer.layout.origin'), info.country],
        [t('page.fullscreenPlayer.layout.genre'), info.genre],
    ].filter(([, value]) => value);

    return (
        <>
            <div className={styles.stageHero}>
                <CoverWash src={np.cover} />
                <ArtistBackdrop className={styles.photo} position="center 30%" />
                <div className={styles.stageShade} />
            </div>
            <div className={styles.stageTop}>
                {info.logo ? (
                    <img alt={np.artist} className={styles.stageLogo} src={info.logo} />
                ) : (
                    <div className={styles.stageName}>{np.artist}</div>
                )}
                {about.length > 0 && (
                    <div className={styles.stageAbout}>
                        {about.map(([label, value]) => (
                            <span key={label as string}>
                                {label} <b>{value}</b>
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className={styles.stageNow}>
                <Cover className={styles.stageCover} src={np.cover} />
                <div className={styles.stageText}>
                    <h1 className={styles.stageTitle}>{np.title}</h1>
                    <div className={styles.stageSub}>{joinDot(np.artist, np.album, np.year)}</div>
                    <Chips chips={np.chips.slice(0, 3)} />
                </div>
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
