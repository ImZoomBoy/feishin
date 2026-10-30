import clsx from 'clsx';
import { DragEvent, MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import styles from './queue-list.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { isShuffleEnabled, usePlayerStoreBase } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Icon } from '/@/shared/components/icon/icon';
import { LibraryItem, QueueSong } from '/@/shared/types/domain-types';

// Only a stretch of the queue is shown either side; very long queues just get a count
const LIMIT = 100;

type Edge = 'bottom' | 'top';

// The queue in play order (shuffle aware) and where the current song sits in it
const usePlayOrder = (pick: (songs: QueueSong[], position: number) => QueueSong[]) =>
    usePlayerStoreBase(
        useShallow((state) => {
            const { items } = state.getQueue();
            const order = isShuffleEnabled(state) ? state.queue.shuffled : items.map((_, i) => i);
            const position = Math.max(state.player.index, 0);
            return pick(
                order.map((i) => items[i]),
                position,
            ).filter(Boolean);
        }),
    );

const useQueueRemaining = () =>
    usePlayerStoreBase((state) => state.getQueue().items.length - state.player.index - 1);

const usePriorityIds = () => usePlayerStoreBase(useShallow((state) => state.queue.priority));

type RowProps = {
    current?: boolean;
    dropEdge?: Edge;
    onDragOver?: (event: DragEvent, song: QueueSong) => void;
    onDragStart?: (song: QueueSong) => void;
    onDrop?: (song: QueueSong) => void;
    onMenu: (event: MouseEvent, song: QueueSong) => void;
    onSelect: (event: MouseEvent, song: QueueSong) => void;
    selected?: boolean;
    song: QueueSong;
};

const Row = ({
    current,
    dropEdge,
    onDragOver,
    onDragStart,
    onDrop,
    onMenu,
    onSelect,
    selected,
    song,
}: RowProps) => {
    const { mediaPlay } = usePlayer();
    const artist = song.artists?.map((a) => a.name).join(', ') || song.albumArtists?.[0]?.name;
    const play = () => !current && mediaPlay(song._uniqueId);

    return (
        <div
            className={clsx(styles.row, {
                [styles.current]: current,
                [styles.dropBottom]: dropEdge === 'bottom',
                [styles.dropTop]: dropEdge === 'top',
                [styles.selected]: selected,
            })}
            draggable={!!onDragStart}
            onClick={(event) => onSelect(event, song)}
            onContextMenu={(event) => onMenu(event, song)}
            onDoubleClick={play}
            onDragOver={onDragOver && ((event) => onDragOver(event, song))}
            onDragStart={onDragStart && (() => onDragStart(song))}
            onDrop={
                onDrop &&
                ((event) => {
                    event.preventDefault();
                    onDrop(song);
                })
            }
            role="button"
            tabIndex={0}
        >
            <span className={styles.coverWrap}>
                <ItemImage
                    containerClassName={styles.cover}
                    explicitStatus={song.explicitStatus}
                    id={song.imageId}
                    itemType={LibraryItem.SONG}
                    serverId={song._serverId}
                    type="table"
                />
                {!current && (
                    <button
                        className={styles.play}
                        onClick={(event) => {
                            event.stopPropagation();
                            play();
                        }}
                        type="button"
                    >
                        <Icon icon="mediaPlay" />
                    </button>
                )}
            </span>
            <span className={styles.text}>
                <span className={styles.title}>{song.name}</span>
                <span className={styles.artist}>{artist}</span>
            </span>
        </div>
    );
};

// Spotify-style queue, used by the full screen layouts and the sidebar.
// Click selects (Ctrl/Shift for more), double-click plays, drag to move.
export const QueueList = ({ onClose }: { onClose?: () => void }) => {
    const { t } = useTranslation();
    const { moveSelectedTo } = usePlayer();
    const [view, setView] = useState<'queue' | 'recent'>('queue');
    const [selected, setSelected] = useState<string[]>([]);
    const [anchor, setAnchor] = useState<string>();
    const [dragging, setDragging] = useState<QueueSong[]>([]);
    const [drop, setDrop] = useState<{ edge: Edge; id: string }>();

    const [current, ...ahead] = usePlayOrder((songs, at) => songs.slice(at, at + LIMIT + 1));
    const played = usePlayOrder((songs, at) => songs.slice(Math.max(at - LIMIT, 0), at).reverse());
    const remaining = useQueueRemaining();
    const priority = new Set(usePriorityIds());

    const upNext = ahead.filter((song) => priority.has(song._uniqueId));
    const rest = ahead.filter((song) => !priority.has(song._uniqueId));
    const more = remaining - ahead.length;
    const visible = view === 'queue' ? [current, ...upNext, ...rest].filter(Boolean) : played;
    const selectedSongs = visible.filter((song) => selected.includes(song._uniqueId));

    const onSelect = (event: MouseEvent, song: QueueSong) => {
        const id = song._uniqueId;
        if (event.shiftKey && anchor) {
            const ids = visible.map((s) => s._uniqueId);
            const from = ids.indexOf(anchor);
            const to = ids.indexOf(id);
            if (from !== -1) {
                setSelected(ids.slice(Math.min(from, to), Math.max(from, to) + 1));
                return;
            }
        }
        setAnchor(id);
        if (event.ctrlKey || event.metaKey) {
            setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
        } else {
            setSelected([id]);
        }
    };

    const onMenu = (event: MouseEvent, song: QueueSong) => {
        event.preventDefault();
        const items = selected.includes(song._uniqueId) ? selectedSongs : [song];
        if (items.length === 1) setSelected([song._uniqueId]);
        ContextMenuController.call({ cmd: { items, type: LibraryItem.QUEUE_SONG }, event });
    };

    // Dragging a selected song moves the whole selection
    const onDragStart = (song: QueueSong) =>
        setDragging(selected.includes(song._uniqueId) ? selectedSongs : [song]);

    const onDragOver = (event: DragEvent, song: QueueSong) => {
        if (dragging.length === 0) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const edge = event.clientY < box.top + box.height / 2 ? 'top' : 'bottom';
        if (drop?.id !== song._uniqueId || drop.edge !== edge) {
            setDrop({ edge, id: song._uniqueId });
        }
    };

    const endDrag = () => {
        setDragging([]);
        setDrop(undefined);
    };

    const onDrop = (song: QueueSong) => {
        const isOwn = dragging.some((s) => s._uniqueId === song._uniqueId);
        if (drop && !isOwn) moveSelectedTo(dragging, drop.edge, song._uniqueId);
        endDrag();
    };

    const row = (song: QueueSong, draggable = true) => (
        <Row
            dropEdge={drop?.id === song._uniqueId ? drop.edge : undefined}
            key={song._uniqueId}
            onDragOver={draggable ? onDragOver : undefined}
            onDragStart={draggable ? onDragStart : undefined}
            onDrop={draggable ? onDrop : undefined}
            onMenu={onMenu}
            onSelect={onSelect}
            selected={selected.includes(song._uniqueId)}
            song={song}
        />
    );

    return (
        <div
            className={styles.root}
            onDragEnd={endDrag}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop(undefined);
            }}
        >
            <header className={styles.header}>
                {(['queue', 'recent'] as const).map((tab) => (
                    <button
                        className={clsx(styles.tab, view === tab && styles.active)}
                        key={tab}
                        onClick={() => {
                            setView(tab);
                            setSelected([]);
                        }}
                        type="button"
                    >
                        {t(`page.fullscreenPlayer.queue.${tab}`)}
                    </button>
                ))}
                {onClose && (
                    <ActionIcon
                        className={styles.close}
                        icon="x"
                        iconProps={{ size: 'lg' }}
                        onClick={onClose}
                        tooltip={{ label: t('common.close') }}
                        variant="subtle"
                    />
                )}
            </header>
            <div className={styles.list}>
                {view === 'queue' ? (
                    <>
                        {current && (
                            <section>
                                <h3>{t('page.fullscreenPlayer.queue.nowPlaying')}</h3>
                                <Row
                                    current
                                    onMenu={onMenu}
                                    onSelect={onSelect}
                                    selected={selected.includes(current._uniqueId)}
                                    song={current}
                                />
                            </section>
                        )}
                        {upNext.length > 0 && (
                            <section>
                                <h3>{t('page.fullscreenPlayer.upNext')}</h3>
                                {upNext.map((song) => row(song))}
                            </section>
                        )}
                        {rest.length > 0 && (
                            <section>
                                <h3>{t('page.fullscreenPlayer.queue.nextInQueue')}</h3>
                                {rest.map((song) => row(song))}
                                {more > 0 && (
                                    <p className={styles.note}>
                                        {t('page.fullscreenPlayer.queue.more', { count: more })}
                                    </p>
                                )}
                            </section>
                        )}
                    </>
                ) : played.length > 0 ? (
                    <section>{played.map((song) => row(song, false))}</section>
                ) : (
                    <p className={styles.note}>{t('page.fullscreenPlayer.queue.nothingPlayed')}</p>
                )}
            </div>
        </div>
    );
};
