// Shared homepage/Admin track selection. Overrides belong to the active season.
(function () {
    const bonusFields = ['polePositionDriver', 'fastestLapDriverR1', 'fastestLapDriverR2',
        'fastestLapOffPodiumDriverR1', 'fastestLapOffPodiumDriverR2'];

    function hasResults(race) {
        return ['resultsRace1', 'resultsRace2'].some(key =>
            race[key] && typeof race[key] === 'object' && Object.keys(race[key]).length > 0)
            || ['participantsRace1', 'participantsRace2'].some(key =>
                Object.prototype.hasOwnProperty.call(race, key))
            || bonusFields.some(key => Boolean(race[key]));
    }

    function nextTrack(season) {
        const races = season && season.races && typeof season.races === 'object'
            ? season.races
            : {};
        const keys = Object.keys(races).sort((a, b) =>
            ((parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0))
            || a.localeCompare(b));
        let lastResult = -1;
        keys.forEach((key, index) => {
            if (hasResults(races[key] || {})) lastResult = index;
        });
        const nextKey = keys[lastResult + 1];
        const trackName = nextKey ? (races[nextKey] || {}).trackName : '';
        return typeof trackName === 'string' && trackName.trim() ? trackName.trim() : 'TBD';
    }

    function selectedTrack(season, fallback) {
        if (!season) return fallback || 'TBD';
        return season.homepageTrackOverride || nextTrack(season);
    }

    let seasonDoc = null;
    let season = null;
    let fallback = 'TBD';
    let ready = false;
    let started = false;
    let formDirty = false;
    const el = id => document.getElementById(id);

    function render() {
        const name = selectedTrack(season, fallback);
        if (el('raceLocation')) el('raceLocation').textContent = name;
        if (el('raceTrackImage')) {
            const tracks = typeof trackData !== 'undefined' && Array.isArray(trackData) ? trackData : [];
            const track = tracks.find(item => item.name === name);
            el('raceTrackImage').src = track ? track.imagePath : 'Logos_and_icons/racetracks/TBD.png';
            el('raceTrackImage').alt = `${name} track layout`;
        }
        const select = el('raceTrackSelect');
        if (!select) return;
        select.disabled = !ready;
        if (!formDirty) {
            if (!Array.from(select.options).some(option => option.value === name)) {
                select.add(new Option(name, name));
            }
            select.value = season && !season.homepageTrackOverride ? '__automatic__' : name;
        }
        if (el('currentRaceTrack')) {
            el('currentRaceTrack').textContent = `Showing: ${name}${season && !season.homepageTrackOverride ? ' (automatic)' : ''}`;
        }
        const automaticOption = select.querySelector('option[value="__automatic__"]');
        if (automaticOption) automaticOption.disabled = !season;
    }

    function renderUnavailable(message) {
        ready = false;
        if (el('raceLocation')) el('raceLocation').textContent = 'TBD';
        if (el('raceTrackImage')) {
            el('raceTrackImage').src = 'Logos_and_icons/racetracks/TBD.png';
            el('raceTrackImage').alt = 'Track unavailable';
        }
        const select = el('raceTrackSelect');
        if (select) select.disabled = true;
        if (el('currentRaceTrack')) el('currentRaceTrack').textContent = message;
    }

    async function save(mode, track) {
        if (!ready) throw new Error('Track settings are still loading. Please try again.');
        if (seasonDoc) {
            const savedDoc = seasonDoc;
            const override = mode === 'manual' ? track || 'TBD' : null;
            // Avoid silently applying an override to a season deactivated in another tab.
            const savedSeason = await firebase.firestore().runTransaction(async transaction => {
                const latest = await transaction.get(savedDoc.ref);
                if (!latest.exists || latest.data().isActive !== true) {
                    throw new Error('The active season has changed. Refresh this page before saving.');
                }
                transaction.update(savedDoc.ref, { homepageTrackOverride: override });
                return { ...latest.data(), homepageTrackOverride: override };
            });
            if (seasonDoc?.id === savedDoc.id) season = savedSeason;
        } else {
            await firebase.database().ref('race_location').set(track || 'TBD');
            fallback = track || 'TBD';
        }
        formDirty = false;
        render();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const select = el('raceTrackSelect');
        if (select) {
            select.disabled = !ready;
            select.addEventListener('change', () => { formDirty = true; });
        }
    });

    document.addEventListener('oneEleven:activeDriver', () => {
        if (started || (!el('raceTrackImage') && !el('raceTrackSelect'))) return;
        started = true;
        firebase.database().ref('race_location').on('value', snapshot => {
            fallback = snapshot.val() || 'TBD';
            if (ready) render();
        });
        // Read up to two so corrupt data with multiple active seasons is not resolved arbitrarily.
        firebase.firestore().collection('championships').where('isActive', '==', true).limit(2)
            .onSnapshot(snapshot => {
                if (snapshot.docs.length > 1) {
                    seasonDoc = null;
                    season = null;
                    formDirty = false;
                    renderUnavailable('More than one championship is active. Choose one active season in Championship Admin.');
                    return;
                }
                const nextDoc = snapshot.empty ? null : snapshot.docs[0];
                if (nextDoc?.id !== seasonDoc?.id) formDirty = false;
                seasonDoc = nextDoc;
                season = seasonDoc ? seasonDoc.data() : null;
                ready = true;
                render();
            }, error => {
                console.error('Unable to load championship track:', error);
                season = null;
                renderUnavailable('Unable to load track settings. Refresh to try again.');
            });
    });

    window.oneElevenRaceTrack = { nextTrack, selectedTrack, save };
})();
