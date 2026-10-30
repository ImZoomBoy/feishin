import { CSSProperties } from 'react';

import styles from './artist-hero.module.css';

import {
    ArtistBackdrop,
    BackdropArtist,
} from '/@/renderer/features/player/components/artist-backdrop';

// Wide, slowly rotating photos of the artist behind the top of their page,
// fading into a glow of the artist's colour further down
export const ArtistHero = ({ artist, color }: { artist?: BackdropArtist; color?: string }) => {
    if (!artist) return null;

    return (
        <div
            className={styles.hero}
            style={{ '--artist-color': color || 'transparent' } as CSSProperties}
        >
            <div className={styles.glow} />
            <div className={styles.photos}>
                <ArtistBackdrop artists={[artist]} className={styles.photo} position="center 30%" />
                <div className={styles.shade} />
            </div>
        </div>
    );
};
