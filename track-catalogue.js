// Shared track list for every page. Load after tracks.js and catalogue.js.
// Uses the Racing Setup catalogue once it exists; before setup it uses the
// built-in list in tracks.js. If a configured catalogue cannot be loaded, the
// built-in list is shown for display with a visible warning.
(function () {
    const C = window.OneElevenCatalogue;
    const PATH = 'seasonPlanning/v1/catalogue';
    const bundled = typeof trackData !== 'undefined' && Array.isArray(trackData) ? trackData : [];
    // 'loading' → 'catalogue' (set up), 'bundled' (not set up yet) or 'unavailable' (failed to load).
    let status = 'loading';
    let catalogue = null;
    let index = new Map();
    let started = false;

    function selectable() {
        return status === 'catalogue' ? C.trackList(catalogue) : bundled;
    }

    // Finds a track by its current name or any former name/alias, including
    // archived tracks, so saved championships keep their labels and images.
    function resolve(name) {
        if (status === 'catalogue') {
            const layout = C.resolveLayout(catalogue, index, name);
            if (layout) return { ...layout, imagePath: layout.imagePath || C.PLACEHOLDER_IMAGE, shortName: layout.shortName || layout.name };
        }
        const key = C.nameKey(name);
        return bundled.find(track => C.nameKey(track.name) === key) || null;
    }

    function imageFor(name) {
        const track = resolve(name);
        return (track && track.imagePath) || C.PLACEHOLDER_IMAGE;
    }

    function statusMessage() {
        if (status === 'unavailable') {
            return 'The track catalogue could not be loaded, so the built-in track list is shown. Refresh before saving track choices.';
        }
        return '';
    }

    // Keeps window.trackMap (used for short labels on the championship pages) in step.
    // Saved names keep their own wording as the full label.
    function rebuildTrackMap() {
        const map = window.trackMap || (window.trackMap = {});
        bundled.forEach(track => { map[track.name] = { short: track.shortName, full: track.name }; });
        if (status !== 'catalogue') return;
        C.trackList(catalogue, { includeArchived: true }).forEach(track => {
            const layout = catalogue.layouts[track.id];
            [layout.name, ...C.aliasList(layout)].forEach(name => { map[name] = { short: track.shortName, full: name }; });
        });
    }

    function notify() {
        rebuildTrackMap();
        document.querySelectorAll('[data-track-catalogue-status]').forEach(element => {
            element.textContent = statusMessage();
            element.hidden = !statusMessage();
        });
        document.dispatchEvent(new CustomEvent('oneEleven:tracksChanged', { detail: { status } }));
    }

    function start() {
        if (started || !window.firebase || typeof firebase.auth !== 'function' || typeof firebase.database !== 'function') return;
        started = true;
        firebase.auth().onAuthStateChanged(user => {
            if (!user) return;
            firebase.database().ref(PATH).on('value', snapshot => {
                catalogue = snapshot.val();
                const configured = Boolean(catalogue && catalogue.layouts);
                status = configured ? 'catalogue' : 'bundled';
                index = configured ? C.buildLayoutIndex(catalogue) : new Map();
                notify();
            }, error => {
                console.error('Unable to load the track catalogue:', error);
                status = 'unavailable';
                notify();
            });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.oneElevenTracks = { selectable, resolve, imageFor, statusMessage, status: () => status };
})();
