// Loaded only by tools/preview.py, replacing all Firebase SDK scripts.
(function () {
    const storageKey = 'oneElevenSamplePreview';
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
    const realtimeListeners = new Map();
    const seasonListeners = new Set();
    function persist() { sessionStorage.setItem(storageKey, JSON.stringify(data)); }
    function read(path) { return path.split('/').filter(Boolean).reduce((v, key) => v?.[key], data.realtime) ?? null; }
    function snapshot(path) { return { val: () => copy(read(path)), exists: () => read(path) !== null }; }
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
            },
            update: async values => {
                for (const [key, value] of Object.entries(values)) await ref(key).set(value);
            },
            set: (value, callback) => {
                const keys = path.split('/');
                const last = keys.pop();
                const parent = keys.reduce((v, key) => v[key] ||= {}, data.realtime);
                parent[last] = copy(value);
                persist();
                realtimeListeners.get(path)?.forEach(listener => listener(snapshot(path)));
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
        database: () => ({ ref }),
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
