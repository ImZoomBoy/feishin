import merge from 'lodash/merge';
import omit from 'lodash/omit';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

export type FullScreenPlayerImageSource = 'album' | 'artist';

// Artist photo led layouts, then 'classic' (Feishin's original layout). The order sets the hotkeys.
export const FULL_SCREEN_LAYOUTS = [
    'cinema',
    'editorial',
    'refined',
    'poster',
    'stage',
    'classic',
] as const;

export type FullScreenPlayerItemAlignment = 'center' | 'left' | 'right';

export type FullScreenPlayerLayout = (typeof FULL_SCREEN_LAYOUTS)[number];

export interface FullScreenPlayerSlice extends FullScreenPlayerState {
    actions: {
        setStore: (data: Partial<FullScreenPlayerSlice>) => void;
    };
}

export type FullScreenPlayerTitleDisplayType = 'multiLine' | 'scroll';

interface FullScreenPlayerState {
    activeTab: 'lyrics' | 'queue' | 'related' | string;
    coverArtSize: number;
    dynamicBackground?: boolean;
    dynamicImageBlur: number;
    dynamicImageSource?: FullScreenPlayerImageSource;
    dynamicIsImage?: boolean;
    expanded: boolean;
    fanartApiKey?: string;
    layout?: FullScreenPlayerLayout;
    lidarrApiKey?: string;
    // Artists switched to a broader Lidarr profile by Feishin, keyed by `${lidarrUrl}|${artistId}`,
    // with what to put back
    lidarrRestore?: Record<string, { monitorNewItems?: string; profileId: number }>;
    lidarrUrl?: string;
    opacity: number;
    playerItemAlignment: FullScreenPlayerItemAlignment;
    titleDisplayType: FullScreenPlayerTitleDisplayType;
    titleLineCount: number;
    useImageAspectRatio: boolean;
    visualizerExpanded: boolean;
    visualizerReturnToPlayer: boolean;
}

export const useFullScreenPlayerStore = createWithEqualityFn<FullScreenPlayerSlice>()(
    persist(
        devtools(
            immer((set, get) => ({
                actions: {
                    setStore: (data) => {
                        set({ ...get(), ...data });
                    },
                },
                activeTab: '',
                coverArtSize: 75,
                dynamicBackground: true,
                dynamicImageBlur: 6,
                dynamicImageSource: 'album',
                dynamicIsImage: false,
                expanded: false,
                layout: 'classic',
                opacity: 25,
                playerItemAlignment: 'center',
                titleDisplayType: 'scroll',
                titleLineCount: 1,
                useImageAspectRatio: false,
                visualizerExpanded: false,
                visualizerReturnToPlayer: false,
            })),
            { name: 'store_full_screen_player' },
        ),
        {
            merge: (persistedState, currentState) => {
                return merge(currentState, persistedState);
            },
            migrate: (persistedState, version) => {
                if (version <= 2) {
                    return {} as FullScreenPlayerState;
                }

                if (version <= 4) {
                    const state = persistedState as { coverArtSize?: number | string };
                    const legacyCoverArtSizeMap: Record<string, number> = {
                        large: 100,
                        medium: 75,
                        small: 50,
                    };

                    if (typeof state.coverArtSize === 'string') {
                        state.coverArtSize = legacyCoverArtSizeMap[state.coverArtSize] ?? 75;
                    }
                }

                return persistedState;
            },
            name: 'store_full_screen_player',
            // `visualizerReturnToPlayer` is transient navigation intent used only to route
            // the "shrink visualizer" action back to the full-screen player; it isn't
            // meaningful across app restarts, so it's excluded from persistence.
            partialize: (state) => omit(state, ['visualizerReturnToPlayer']),
            version: 5,
        },
    ),
);

export const useFullScreenPlayerStoreActions = () =>
    useFullScreenPlayerStore((state) => state.actions);

export const useSetFullScreenPlayerStore = () =>
    useFullScreenPlayerStore((state) => state.actions.setStore);

// The artist photo background takes over the page, so the cover moves out of the way
export const useIsArtistBackdropMode = () =>
    useFullScreenPlayerStore(
        (state) =>
            Boolean(state.dynamicBackground && state.dynamicIsImage) &&
            state.dynamicImageSource === 'artist',
    );

export const useFullScreenPlayerOverlayState = () =>
    useFullScreenPlayerStore(
        (state) => ({
            expanded: state.expanded,
            visualizerExpanded: state.visualizerExpanded,
        }),
        shallow,
    );
