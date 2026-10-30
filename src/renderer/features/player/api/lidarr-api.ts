// Small Lidarr (API v1) and MusicBrainz client for the full screen discography.

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

export interface LidarrArtist {
    [key: string]: unknown;
    artistName: string;
    foreignArtistId?: string;
    id: number;
    metadataProfileId?: number;
    monitorNewItems?: string;
}

export interface LidarrClient {
    apiKey: string;
    url: string;
}

export interface MetadataProfile {
    id?: number;
    name: string;
    primaryAlbumTypes: ProfileType[];
    releaseStatuses: unknown[];
    secondaryAlbumTypes: ProfileType[];
}

// What to put back when an artist goes back to their original profile
export interface ProfileRestore {
    monitorNewItems?: string;
    profileId: number;
}

// A MusicBrainz release group (an album, with all its editions)
export interface ReleaseGroup {
    'first-release-date'?: string;
    id: string;
    'primary-type'?: null | string;
    'secondary-types'?: string[];
    title: string;
}

interface Command {
    id: number;
    status?: string;
}

interface ProfileType {
    albumType: { id: number; name: string };
    allowed: boolean;
}

export const lidarrRequest = async <T>(
    client: LidarrClient,
    path: string,
    init?: RequestInit,
): Promise<T> => {
    const res = await fetch(`${client.url.replace(/\/+$/, '')}/api/v1${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': client.apiKey },
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
};

const json = (method: string, body: unknown): RequestInit => ({
    body: JSON.stringify(body),
    method,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Every official release group by an artist. MusicBrainz allows about one request a second.
export const fetchReleaseGroups = async (artistMbid: string): Promise<ReleaseGroup[]> => {
    const groups: ReleaseGroup[] = [];
    for (let offset = 0, page = 0; page < 5; page += 1) {
        if (page > 0) await sleep(1100);
        const url =
            `https://musicbrainz.org/ws/2/release-group?artist=${artistMbid}` +
            `&release-group-status=website-default&limit=100&offset=${offset}&fmt=json`;
        let res = await fetch(url, { headers: { Accept: 'application/json' } });
        // MusicBrainz answers 503 when it's busy or we're going too fast: back off and retry
        for (let attempt = 1; res.status === 503 && attempt <= 4; attempt += 1) {
            await sleep(2000 * attempt);
            res = await fetch(url, { headers: { Accept: 'application/json' } });
        }
        if (!res.ok) throw new Error(`MusicBrainz returned ${res.status}`);
        const data = await res.json();
        const batch: ReleaseGroup[] = data['release-groups'] ?? [];
        groups.push(...batch);
        offset += batch.length;
        if (!batch.length || offset >= (data['release-group-count'] ?? 0)) break;
    }
    return groups;
};

export const releaseGroupCover = (id: string) =>
    `https://coverartarchive.org/release-group/${id}/front-250`;

// The album types a release group needs a profile to allow, in Lidarr's naming
export const typesOf = (group: ReleaseGroup) => ({
    primary: group['primary-type'] || 'Album',
    secondary: group['secondary-types']?.length ? group['secondary-types'] : ['Studio'],
});

const allowedNames = (types: ProfileType[]) =>
    new Set(types.filter((type) => type.allowed).map((type) => type.albumType.name.toLowerCase()));

const allowsAll = (types: ProfileType[], names: string[]) => {
    const allowed = allowedNames(types);
    return names.every((name) => allowed.has(name.toLowerCase()));
};

export const profileAllows = (profile: MetadataProfile, group: ReleaseGroup) => {
    const { primary, secondary } = typesOf(group);
    return (
        allowsAll(profile.primaryAlbumTypes, [primary]) &&
        allowsAll(profile.secondaryAlbumTypes, secondary)
    );
};

const allowedCount = (profile: MetadataProfile) =>
    allowedNames(profile.primaryAlbumTypes).size + allowedNames(profile.secondaryAlbumTypes).size;

const covers = (profile: MetadataProfile, current: MetadataProfile) =>
    allowsAll(profile.primaryAlbumTypes, [...allowedNames(current.primaryAlbumTypes)]) &&
    allowsAll(profile.secondaryAlbumTypes, [...allowedNames(current.secondaryAlbumTypes)]) &&
    JSON.stringify(profile.releaseStatuses.map(statusKey).sort()) ===
        JSON.stringify(current.releaseStatuses.map(statusKey).sort());

const statusKey = (status: unknown) => {
    const value = status as { allowed?: boolean; releaseStatus?: { name?: string } };
    return `${value.releaseStatus?.name}:${Boolean(value.allowed)}`;
};

// The narrowest existing profile that keeps everything the artist has now and adds
// what this release needs. Returns undefined when one has to be created.
const pickProfile = (profiles: MetadataProfile[], current: MetadataProfile, group: ReleaseGroup) =>
    profiles
        .filter((profile) => covers(profile, current) && profileAllows(profile, group))
        .sort((a, b) => allowedCount(a) - allowedCount(b))[0];

const buildProfile = (current: MetadataProfile, group: ReleaseGroup): MetadataProfile => {
    const { primary, secondary } = typesOf(group);
    const allow = (types: ProfileType[], names: string[]) =>
        types.map((type) => ({
            ...type,
            allowed:
                type.allowed ||
                names.some((name) => name.toLowerCase() === type.albumType.name.toLowerCase()),
        }));
    const added = [...secondary.filter((name) => name !== 'Studio'), primary]
        .filter((name) => name !== 'Album')
        .join(', ');

    return {
        ...current,
        id: undefined,
        name: `${current.name} + ${added}`,
        primaryAlbumTypes: allow(current.primaryAlbumTypes, [primary]),
        secondaryAlbumTypes: allow(current.secondaryAlbumTypes, secondary),
    };
};

const waitForCommand = async (client: LidarrClient, command: Command) => {
    const deadline = Date.now() + 3 * 60 * 1000;
    let status = command.status;
    while (!['aborted', 'cancelled', 'completed', 'failed'].includes(status || '')) {
        if (Date.now() > deadline) throw new Error('Lidarr took too long to refresh the artist');
        await sleep(1500);
        status = (await lidarrRequest<Command>(client, `/command/${command.id}`)).status;
    }
    if (status !== 'completed') throw new Error(`Lidarr refresh ${status}`);
};

const refreshArtist = async (client: LidarrClient, artistId: number) =>
    waitForCommand(
        client,
        await lidarrRequest<Command>(
            client,
            '/command',
            json('POST', { artistId, name: 'RefreshArtist' }),
        ),
    );

const setAlbumsMonitored = (client: LidarrClient, albumIds: number[], monitored: boolean) =>
    lidarrRequest(client, '/album/monitor', json('PUT', { albumIds, monitored }));

export const searchAlbum = async (client: LidarrClient, albumId: number) => {
    await setAlbumsMonitored(client, [albumId], true);
    await lidarrRequest(
        client,
        '/command',
        json('POST', { albumIds: [albumId], name: 'AlbumSearch' }),
    );
};

// Gets a release that the artist's profile leaves out, e.g. a live album:
// 1. pick (or create) a profile that also allows its type, and switch the artist to it
//    with new-album monitoring off, so the releases it adds are not downloaded
// 2. refresh the artist so Lidarr adds the release
// 3. unmonitor anything that got monitored anyway, then monitor and search just this one
// 4. turn new-album monitoring back on
export const getReleaseOutsideProfile = async ({
    artistId,
    client,
    group,
    onSwitchProfile,
}: {
    artistId: number;
    client: LidarrClient;
    group: ReleaseGroup;
    onSwitchProfile: (restore: ProfileRestore) => void;
}) => {
    const artist = await lidarrRequest<LidarrArtist>(client, `/artist/${artistId}`);
    const profiles = await lidarrRequest<MetadataProfile[]>(client, '/metadataprofile');
    const current = profiles.find((profile) => profile.id === artist.metadataProfileId);
    if (!current) throw new Error("Couldn't find the artist's metadata profile");

    // The profile already allows this type, so Lidarr left it out for another reason
    // (usually an unofficial release). Switching profiles wouldn't add it.
    if (profileAllows(current, group)) {
        throw new Error("Lidarr doesn't list this release, so it can't be fetched");
    }

    let target = pickProfile(profiles, current, group);
    if (!target) {
        target = await lidarrRequest<MetadataProfile>(
            client,
            '/metadataprofile',
            json('POST', buildProfile(current, group)),
        );
    }

    const before = await lidarrRequest<LidarrAlbum[]>(client, `/album?artistId=${artistId}`);
    const monitoredBefore = new Set(before.filter((album) => album.monitored).map((a) => a.id));

    if (target.id !== current.id) {
        onSwitchProfile({ monitorNewItems: artist.monitorNewItems, profileId: current.id! });
    }

    await lidarrRequest(
        client,
        `/artist/${artistId}`,
        json('PUT', { ...artist, metadataProfileId: target.id, monitorNewItems: 'none' }),
    );

    try {
        await refreshArtist(client, artistId);

        const after = await lidarrRequest<LidarrAlbum[]>(client, `/album?artistId=${artistId}`);
        const unexpected = after
            .filter((album) => album.monitored && !monitoredBefore.has(album.id))
            .map((album) => album.id);
        if (unexpected.length) await setAlbumsMonitored(client, unexpected, false);

        const album = after.find((a) => a.foreignAlbumId === group.id);
        if (!album) throw new Error("Lidarr didn't add this release");
        await searchAlbum(client, album.id);
        return album;
    } finally {
        const latest = await lidarrRequest<LidarrArtist>(client, `/artist/${artistId}`);
        await lidarrRequest(
            client,
            `/artist/${artistId}`,
            json('PUT', { ...latest, monitorNewItems: artist.monitorNewItems }),
        );
    }
};

// Puts the artist back on their original profile. Lidarr then drops the extra
// releases it has no files for; anything already downloaded stays.
export const restoreProfile = async (
    client: LidarrClient,
    artistId: number,
    restore: ProfileRestore,
) => {
    const artist = await lidarrRequest<LidarrArtist>(client, `/artist/${artistId}`);
    await lidarrRequest(
        client,
        `/artist/${artistId}`,
        json('PUT', { ...artist, metadataProfileId: restore.profileId }),
    );
    await refreshArtist(client, artistId);
};
