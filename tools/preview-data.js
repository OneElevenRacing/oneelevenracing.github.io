// Loaded only by tools/preview.py, replacing all Firebase SDK scripts.
(function () {
    const storageKey = 'oneElevenSamplePreview';
    function sampleSeasonPlanning() {
        const hour = 3600000;
        const t = Date.now();
        const optionsOf = labels => Object.fromEntries(labels.map(([id, label]) => [id, { label }]));
        const answer = (ids, writeIns = []) => ({ count: ids.length, ...(ids.length ? { slots: Object.fromEntries(ids.map((id, i) => [i, id])), byOption: Object.fromEntries(ids.map((id, i) => [id, i])) } : {}),
            writeInCount: writeIns.length, ...(writeIns.length ? { writeIns: Object.fromEntries(writeIns.map((text, n) => [n, { n, text }])) } : {}) });
        const pickOne = id => ({ count: 1, slots: { 0: id }, byOption: { [id]: 0 } });
        const ballot = (submittedAt, answers) => ({ schema: 1, submissionId: 'sample', submittedAt, revision: 1, answers });
        const classes = [['gt3-gen2', 'GT3 Gen 2'], ['gt4', 'GT4'], ['group-a', 'Group A'], ['formula-junior', 'Formula Junior'], ['porsche-cup', 'Porsche Cup'], ['p2', 'P2']];
        const control = (opensAt, closesAt, extra) => ({ state: 'published', opensAt, closesAt, resultVisibility: 'live', labelsHidden: true, allDrivers: true, ...extra });
        const entry = (title, summary, c, extra) => ({ title, summary, state: c.state, opensAt: c.opensAt, closesAt: c.closesAt, resultVisibility: c.resultVisibility, labelsHidden: c.labelsHidden, standalone: false, planId: 'sample-plan', ...extra });
        const ideas = control(t - 14 * 24 * hour, t - 7 * 24 * hour, { state: 'finalised', resultVisibility: 'afterClose', labelsHidden: false });
        const cars = control(t - 2 * 24 * hour, t + 3 * 24 * hour);
        const round1 = control(t - 6 * 24 * hour, t - 3 * 24 * hour, { state: 'closed' });
        const tracks = control(t - 5 * 24 * hour, t - 1 * 24 * hour, { resultVisibility: 'hidden', labelsHidden: false });
        const rules = control(t - 4 * 24 * hour, t - 2 * hour, { resultVisibility: 'afterClose', labelsHidden: false });
        const feedback = control(t - 24 * hour, t + 6 * 24 * hour, { resultVisibility: 'afterClose', labelsHidden: false });
        const carCounts = { 'gt3-gen2': 8, gt4: 7, 'group-a': 5, 'formula-junior': 4, 'porsche-cup': 2, p2: 1 };
        return {
            plans: { 'sample-plan': { title: 'Next season', intro: 'Help shape the next season. Take part in each stage below.', status: 'active', stageCount: 5, createdAt: t,
                stages: [{ id: 'ideas', label: 'Suggestions' }, { id: 'cars', label: 'Car votes' }, { id: 'tracks', label: 'Tracks' }, { id: 'rules', label: 'Rules' }, { id: 'calendar', label: 'Calendar' }] } },
            index: {
                'sample-ideas': entry('Car class suggestions', 'Suggest the classes you would like to race.', ideas, { kind: 'nomination', stageId: 'ideas' }),
                'sample-round1': entry('Car class · Round 1', 'Choose exactly 3 of 6 classes.', round1, { kind: 'elimination', stageId: 'cars' }),
                'sample-cars': entry('Car class · Round 2', 'Choose exactly 3 of 6 classes. Class names are hidden in results until the reveal.', cars, { kind: 'elimination', stageId: 'cars' }),
                'sample-tracks': entry('Track choice', 'Pick one layout for the calendar.', tracks, { kind: 'track', stageId: 'tracks' }),
                'sample-rules': entry('Rule changes', 'Vote on each proposal.', rules, { kind: 'rules', stageId: 'rules' }),
                'sample-feedback': { ...entry('Race night feedback', 'Two quick questions about race nights.', feedback, { kind: 'custom' }), standalone: true, planId: null }
            },
            polls: {
                'sample-ideas': { control: ideas,
                    definition: { schema: 1, revision: 1, title: 'Car class suggestions', questionCount: 2, questions: {
                        0: { id: 'q1', index: 0, type: 'nomination', kind: 'nomination', required: true, prompt: 'Which car classes would you like to race next season?', minSelections: 0, maxSelections: 6, allowWriteIns: true, maxWriteIns: 20, options: optionsOf(classes) },
                        1: { id: 'q2', index: 1, type: 'text', kind: 'text', required: false, prompt: 'Any rule changes you would like?', maxLength: 2000 } } },
                    ballots: {
                        demo1: ballot(t - 13 * 24 * hour, { 0: answer(['gt4', 'p2'], ['Group C']), 1: { text: 'Allow ghosting on the formation lap.' } }),
                        demo2: ballot(t - 12 * 24 * hour, { 0: answer(['gt3-gen2'], ['group c', 'Formula Vee']), 1: { skipped: true } }),
                        demo3: ballot(t - 11 * 24 * hour, { 0: answer(['gt4', 'formula-junior'], ['Grp C']), 1: { text: 'Reverse grid for race 2, please.' } }),
                        demo4: ballot(t - 10 * 24 * hour, { 0: answer(['gt3-gen2', 'porsche-cup'], ['GT4 ']), 1: { skipped: true } }),
                        demo5: ballot(t - 9 * 24 * hour, { 0: answer([], ['Touring Cars']), 1: { text: 'No reverse grids.' } })
                    },
                    totals: { respondents: 9, questions: { 0: { options: { 'gt3-gen2': 5, gt4: 7, 'group-a': 4, 'formula-junior': 6, 'porsche-cup': 3, p2: 4 } } } } },
                'sample-round1': { control: round1,
                    definition: { schema: 1, revision: 1, title: 'Car class · Round 1', questionCount: 1, questions: { 0: { id: 'q1', index: 0, type: 'class', kind: 'choice', required: true, prompt: 'Which classes should go through?', minSelections: 3, maxSelections: 3, options: optionsOf(classes) } } },
                    totals: { respondents: 10, questions: { 0: { options: { 'gt3-gen2': 8, gt4: 7, 'group-a': 5, 'formula-junior': 5, 'porsche-cup': 3, p2: 2 } } } } },
                'sample-cars': { control: cars,
                    definition: { schema: 1, revision: 1, title: 'Car class · Round 2', questionCount: 1, questions: { 0: { id: 'q1', index: 0, type: 'class', kind: 'choice', required: true, prompt: 'Which classes should go through to the final round?', minSelections: 3, maxSelections: 3, options: optionsOf(classes) } } },
                    totals: { respondents: 9, questions: { 0: { options: carCounts } } } },
                'sample-tracks': { control: tracks,
                    definition: { schema: 1, revision: 1, title: 'Track choice', questionCount: 1, questions: { 0: { id: 'q1', index: 0, type: 'track', kind: 'choice', required: true, prompt: 'Which track layout would you like on the calendar?', minSelections: 1, maxSelections: 1,
                        options: { 'brands-hatch': { label: 'Brands Hatch', locationId: 'brands', locationName: 'Brands Hatch', imagePath: 'Logos_and_icons/racetracks/Brands_Hatch.png' }, 'brands-hatch-indy': { label: 'Brands Hatch Indy', locationId: 'brands', locationName: 'Brands Hatch', imagePath: 'Logos_and_icons/racetracks/Brands_Hatch_Indy.png' }, monza: { label: 'Monza', locationId: 'monza', locationName: 'Monza', imagePath: 'Logos_and_icons/racetracks/Monza.png' },
            imola: { label: 'Imola', locationId: 'imola', locationName: 'Imola', imagePath: 'Logos_and_icons/racetracks/Imola.png' }, 'donington-gp': { label: 'Donington GP', locationId: 'donington', locationName: 'Donington', imagePath: 'Logos_and_icons/racetracks/Donington_GP.png' } } } } },
                    ballots: { demo1: ballot(t - 4 * 24 * hour, { 0: pickOne('brands-hatch') }), demo2: ballot(t - 3 * 24 * hour, { 0: pickOne('brands-hatch-indy') }), demo3: ballot(t - 2 * 24 * hour, { 0: pickOne('monza') }) },
                    totals: { respondents: 3, questions: { 0: { options: { 'brands-hatch': 1, 'brands-hatch-indy': 1, monza: 1 } } } } },
                'sample-rules': { control: rules,
                    definition: { schema: 1, revision: 1, title: 'Rule changes', questionCount: 2, questions: {
                        0: { id: 'q1', index: 0, type: 'yesno', kind: 'choice', required: false, prompt: 'Allow ghosting on the formation lap?', minSelections: 1, maxSelections: 1, options: { yes: { label: 'Yes' }, no: { label: 'No' } } },
                        1: { id: 'q2', index: 1, type: 'yesno', kind: 'choice', required: false, prompt: 'Use a reverse grid for race 2?', minSelections: 1, maxSelections: 1, options: { yes: { label: 'Yes' }, no: { label: 'No' } } } } },
                    totals: { respondents: 10, questions: { 0: { options: { yes: 6, no: 4 } }, 1: { options: { yes: 5, no: 5 } } } } },
                'sample-feedback': { control: feedback,
                    definition: { schema: 1, revision: 1, title: 'Race night feedback', questionCount: 2, questions: {
                        0: { id: 'q1', index: 0, type: 'yesno', kind: 'choice', required: true, prompt: 'Should race night start at 7.30pm instead of 7pm?', minSelections: 1, maxSelections: 1, options: { yes: { label: 'Yes' }, no: { label: 'No' } } },
                        1: { id: 'q2', index: 1, type: 'text', kind: 'text', required: false, prompt: 'Anything else about race nights?', maxLength: 2000 } } },
                    totals: { respondents: 10, questions: { 0: { options: { yes: 6, no: 4 } } } } }
            },
            catalogue: { classes: Object.fromEntries(classes.map(([id, name]) => [id, { name, active: true }])) }
        };
    }
    const copy = value => JSON.parse(JSON.stringify(value));
    const names = ['Alex', 'Jamie', 'Sam', 'Chris', 'Taylor', 'Jordan', 'Morgan', 'Casey', 'Robin', 'Charlie'];
    const drivers = Object.fromEntries(names.map((name, i) => [`demo${i + 1}`, {
        name, active: true, isAdmin: i === 0, carName: 'Sample race car',
        carImage: 'Logos_and_icons/Car_Thumbnails/placeholder.png'
    }]));
    const tracks = ['Brands Hatch', 'Donington GP', 'Oulton Park International', 'Imola',
        'Monza', 'Spielberg', 'Silverstone', 'Bathurst 2020', 'Interlagos GP', 'Jerez Moto'];
    const races = Object.fromEntries(tracks.map((trackName, i) => {
        const race = { trackName, special: false };
        if (i < 6) {
            race.resultsRace1 = Object.fromEntries(names.map((_, n) => [`demo${n + 1}`, ((n + i) % 10) + 1]));
            race.resultsRace2 = Object.fromEntries(names.map((_, n) => [`demo${n + 1}`, ((n + i + 2) % 10) + 1]));
            race.polePositionDriver = `demo${i + 1}`;
            race.fastestLapDriverR1 = 'demo2';
            race.fastestLapDriverR2 = 'demo3';
        }
        return [`race${i + 1}`, race];
    }));
    let data = JSON.parse(sessionStorage.getItem(storageKey) || 'null') || {
        realtime: { drivers, race_location: 'Monza', race_date: 'Wed, 9th Sep', race_time: '7.00pm',
            weather1: 'Clear', weather2: 'Light Cloud', seasonData: { seasonNumber: 'Sample Season', racingClass: 'GT3' } },
        season: { seasonName: 'Sample Season', carClass: 'GT3', isActive: true, dropRaces: 2, races }
    };
    // Connection state for pages that show an offline warning.
    data.realtime['.info'] = { connected: true, serverTimeOffset: 0 };
    // Sample season planning: a plan with polls in each state, for the Polls & Forms pages.
    data.realtime.seasonPlanning ||= {};
    data.realtime.seasonPlanning.v1 ||= {};
    if (data.realtime.seasonPlanning.v1.sampleVersion !== 3) Object.assign(data.realtime.seasonPlanning.v1, sampleSeasonPlanning(), { sampleVersion: 3, visibility: { drivers: true } });
    const realtimeListeners = new Map();
    const seasonListeners = new Set();
    function persist() { sessionStorage.setItem(storageKey, JSON.stringify(data)); }
    function read(path) { return path.split('/').filter(Boolean).reduce((v, key) => v?.[key], data.realtime) ?? null; }
    function snapshot(path) { return { val: () => copy(read(path)), exists: () => read(path) !== null }; }
    // Stand-ins for Firebase's server timestamp and increment values.
    const serverValues = { TIMESTAMP: { '.sv': 'timestamp' }, increment: n => ({ '.sv': { increment: n } }) };
    function resolveServerValues(value, current) {
        if (!value || typeof value !== 'object') return value;
        if (value['.sv'] === 'timestamp') return Date.now();
        if (value['.sv'] && value['.sv'].increment !== undefined) return (typeof current === 'number' ? current : 0) + value['.sv'].increment;
        Object.keys(value).forEach(key => { value[key] = resolveServerValues(value[key], current && current[key]); });
        return value;
    }
    function ref(path = '') {
        return {
            child: name => ref([path, name].filter(Boolean).join('/')),
            once: (_event, callback) => {
                const result = snapshot(path);
                if (callback) setTimeout(() => callback(result), 0);
                return Promise.resolve(result);
            },
            on: (_event, callback) => {
                if (!realtimeListeners.has(path)) realtimeListeners.set(path, new Set());
                realtimeListeners.get(path).add(callback);
                setTimeout(() => callback(snapshot(path)), 0);
                return callback;
            },
            off: () => { realtimeListeners.delete(path); },
            push: () => ({ key: `sample${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` }),
            update: async values => {
                for (const [key, value] of Object.entries(values)) await ref([path, key].filter(Boolean).join('/')).set(value);
            },
            set: (value, callback) => {
                const keys = path.split('/');
                const last = keys.pop();
                const parent = keys.reduce((v, key) => v[key] ||= {}, data.realtime);
                // Like Firebase, writing null deletes the entry.
                if (value === null || value === undefined) delete parent[last];
                else parent[last] = resolveServerValues(copy(value), parent[last]);
                persist();
                // Notify listeners on this path, its parents and its children.
                realtimeListeners.forEach((listeners, listenerPath) => {
                    if (listenerPath === path || !listenerPath || path.startsWith(`${listenerPath}/`) || listenerPath.startsWith(`${path}/`)) {
                        listeners.forEach(listener => listener(snapshot(listenerPath)));
                    }
                });
                if (callback) callback(null);
                return Promise.resolve();
            }
        };
    }
    const seasonRef = { id: 'sample-season' };
    const seasonDoc = () => ({ id: seasonRef.id, ref: seasonRef, exists: true, data: () => copy(data.season) });
    const seasonSnapshot = () => ({ empty: false, docs: [seasonDoc()] });
    const query = {
        where() { return this; }, limit() { return this; },
        get: () => Promise.resolve(seasonSnapshot()),
        onSnapshot: callback => {
            seasonListeners.add(callback);
            setTimeout(() => callback(seasonSnapshot()), 0);
            return () => seasonListeners.delete(callback);
        }
    };
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const options = Array.from({length:7}, (_,i) => {
        const day = new Date(monday); day.setUTCDate(day.getUTCDate() + i);
        return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getUTCDay()]} ${day.getUTCDate()}/${day.getUTCMonth()+1}`;
    });
    const samplePoll = { title: 'Sample availability', weekStart: monday.toISOString().slice(0,10), options };
    data.pollResponses ||= Object.fromEntries(Object.keys(drivers).map((uid,i) => [uid,
        {dayResponses:Object.fromEntries(options.map((day,j)=>[day,['yes','maybe','no'][(i+j)%3]]))}]));
    const responseListeners = new Set();
    const responseSnapshot = () => ({docs:Object.entries(data.pollResponses).map(([id,value])=>({id,data:()=>copy(value)}))});
    const responses = {
        onSnapshot(callback) { responseListeners.add(callback); setTimeout(()=>callback(responseSnapshot()),0); return ()=>responseListeners.delete(callback); },
        doc(uid) { return {
            get: async()=>({exists:!!data.pollResponses[uid],data:()=>copy(data.pollResponses[uid])}),
            set: async value=>{data.pollResponses[uid]=copy(value);persist();responseListeners.forEach(callback=>callback(responseSnapshot()));}
        }; }
    };
    const polls = {
        onSnapshot(callback) { setTimeout(()=>callback({empty:false,docs:[{id:'sample-poll',data:()=>samplePoll}]}),0);return ()=>{}; },
        doc() { return {collection:()=>responses}; }
    };
    const user = { uid: 'demo1' };
    window.firebase = {
        initializeApp() {},
        auth: () => ({ currentUser: user, onAuthStateChanged: callback => { setTimeout(() => callback(user), 0); return () => {}; } }),
        database: Object.assign(() => ({ ref }), { ServerValue: serverValues }),
        firestore: () => ({
            collection: name => {
                if (name === 'polls') return polls;
                if (name !== 'championships') throw new Error('This collection is not part of the sample preview.');
                return query;
            },
            runTransaction: async callback => {
                let patch = {};
                const result = await callback({
                    get: async () => seasonDoc(),
                    update: (_ref, values) => { patch = { ...patch, ...values }; }
                });
                data.season = { ...data.season, ...patch };
                persist();
                seasonListeners.forEach(listener => listener(seasonSnapshot()));
                return result;
            }
        })
    };
})();
