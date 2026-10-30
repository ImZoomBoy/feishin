import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';

import styles from './artist-discography-route.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import {
    ArtistBackdrop,
    useArtistInfoFor,
} from '/@/renderer/features/player/components/artist-backdrop';
import {
    DiscographyTile,
    useLidarrDiscography,
} from '/@/renderer/features/player/components/lidarr-discography';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useCurrentServerId } from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { LibraryItem } from '/@/shared/types/domain-types';

const AlbumListRoute = lazy(() => import('/@/renderer/features/albums/routes/album-list-route'));

// The artist's whole discography, grouped by type, with what's missing from the library
// and what Lidarr could fetch
const ArtistDiscography = ({ artistId }: { artistId: string }) => {
    const { t } = useTranslation();
    const serverId = useCurrentServerId();
    const [searchParams] = useSearchParams();
    const headerRef = useRef<HTMLDivElement>(null);

    const detailQuery = useQuery(
        artistsQueries.albumArtistDetail({ query: { id: artistId }, serverId }),
    );
    const name = detailQuery.data?.name || searchParams.get('artistName') || '';
    const info = useArtistInfoFor(name || undefined);

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
    } = useLidarrDiscography(name ? { id: artistId, name } : undefined);

    const listParams = new URLSearchParams(searchParams);
    listParams.set('view', 'list');

    return (
        <NativeScrollArea
            pageHeaderProps={{
                children: (
                    <LibraryHeaderBar>
                        <LibraryHeaderBar.PlayButton
                            ids={[artistId]}
                            itemType={LibraryItem.ALBUM_ARTIST}
                            variant="default"
                        />
                        <LibraryHeaderBar.Title>{name}</LibraryHeaderBar.Title>
                    </LibraryHeaderBar>
                ),
                offset: 200,
                target: headerRef,
            }}
        >
            <div className={styles.page}>
                <header className={styles.hero} ref={headerRef}>
                    <div className={styles.photos}>
                        {detailQuery.data && (
                            <ArtistBackdrop
                                artists={[
                                    {
                                        id: detailQuery.data.id,
                                        imageId: detailQuery.data.imageId,
                                        imageUrl: detailQuery.data.imageUrl,
                                        name: detailQuery.data.name,
                                    },
                                ]}
                                className={styles.photo}
                                position="center 30%"
                            />
                        )}
                        <div className={styles.shade} />
                    </div>
                    <div className={styles.heroText}>
                        <div className={styles.kicker}>
                            {t('page.albumArtistDetail.fullDiscography')}
                        </div>
                        <h1 className={styles.name}>
                            {info.logo ? (
                                <img alt={name} className={styles.logo} src={info.logo} />
                            ) : (
                                name
                            )}
                        </h1>
                        <div className={styles.meta}>
                            <span>
                                {isLoading
                                    ? t('page.fullscreenPlayer.discography.loading')
                                    : t('page.fullscreenPlayer.discography.summary', {
                                          owned,
                                          total,
                                      })}
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
                            <Link className={styles.listLink} to={`?${listParams}`}>
                                {t('page.albumArtistDetail.albumList')}
                            </Link>
                        </div>
                    </div>
                </header>

                <div className={styles.body}>
                    {notice && <div className={styles.notice}>{notice}</div>}
                    {groups.map((group) => (
                        <section className={styles.group} key={group.key}>
                            <h2>
                                {t(`page.fullscreenPlayer.discography.group.${group.key}`)}
                                <em>
                                    {group.items.filter((item) => item.libraryAlbum).length} /{' '}
                                    {group.items.length}
                                </em>
                            </h2>
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
                                        size="large"
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </NativeScrollArea>
    );
};

// "View discography" from an artist page. ?view=list keeps Feishin's own album list.
const ArtistDiscographyRoute = () => {
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    const [searchParams] = useSearchParams();
    const routeId = (artistId || albumArtistId) as string;

    if (searchParams.get('view') === 'list') return <AlbumListRoute />;

    return (
        <PageErrorBoundary>
            <AnimatedPage key={`artist-discography-${routeId}`}>
                <Suspense fallback={<Spinner container />}>
                    <ArtistDiscography artistId={routeId} />
                </Suspense>
            </AnimatedPage>
        </PageErrorBoundary>
    );
};

export default ArtistDiscographyRoute;
