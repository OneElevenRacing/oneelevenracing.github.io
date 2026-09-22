let currentUserIsActiveDriver = false;
let raceDateMatchesToday = false;
let raceWeatherAlreadySet = false;
let raceDateStatusKnown = false;
let raceWeatherStatusKnown = false;
let weatherSlotValues = ['', ''];
let weatherSlotStatusKnown = [false, false];
let liveWeatherRefs = [];

const WEEKDAY_ABBRS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UK_TIME_ZONE = 'Europe/London';

// This is the function with all of the probabilities and weather. Make sure they add up to 1.00
function generateRandomWeather() {
    const weathers = {
        "Clear": 0.168,
        "Light Cloud": 0.119,
        "Medium Cloud": 0.119,
        "Heavy Cloud": 0.099,
        "Overcast": 0.109,
        "Light Rain": 0.123,
        "Rain": 0.061,
        "Storm": 0.019,
        "Thunderstorm": 0.019,
        "Fog": 0.045,
        "Fog with Rain": 0.016,
        "Heavy Fog": 0.008,
        "Heavy Fog with Rain": 0.008,
        "Hazy": 0.008,
        "Random": 0.015,
        "Ian's Choice": 0.008,
        "Richard's Choice": 0.008,
        "Sam's Choice": 0.008,
        "Chris' Choice": 0.008,
        "Fabian's Choice": 0.008,
        "Konner's Choice": 0.008,
        "James' Choice": 0.008,
        "Tom's Choice": 0.008
    };

    let totalWeight = Object.values(weathers).reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    let weightSum = 0;

    for (const [weather, weight] of Object.entries(weathers)) {
        weightSum += weight;
        if (random < weightSum) {
            return weather;
        }
    }

    return Object.keys(weathers)[0]; // Fallback to the first weather type
}

function getDaySuffix(day) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

function formatDate(date) {
    const key = getUkDateKey(date);
    const [year, month, day] = key.split('-').map(Number);
    const ukDate = new Date(Date.UTC(year, month - 1, day, 12));
    return `${WEEKDAY_ABBRS[ukDate.getUTCDay()]}, ${day}${getDaySuffix(day)} ${MONTH_ABBRS[month - 1]} ${year}`;
}

function getUkDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: UK_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}

function isValidDateParts(year, month, day) {
    const candidate = new Date(Date.UTC(year, month, day));
    return candidate.getUTCFullYear() === year
        && candidate.getUTCMonth() === month
        && candidate.getUTCDate() === day;
}

function raceDateTextToKey(dateText, referenceKey = getUkDateKey()) {
    const match = String(dateText || '').trim().match(
        /^(?:[A-Za-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})(?:\s+(\d{4}))?$/i
    );
    if (!match) return '';

    const month = MONTH_ABBRS.findIndex(value => value.toLowerCase() === match[2].toLowerCase());
    const day = Number(match[1]);
    if (month < 0) return '';

    const referenceYear = Number(referenceKey.slice(0, 4));
    const explicitYear = match[3] ? Number(match[3]) : null;
    const years = explicitYear === null
        ? [referenceYear - 1, referenceYear, referenceYear + 1]
        : [explicitYear];
    const referenceTime = Date.parse(`${referenceKey}T00:00:00Z`);
    const candidates = years
        .filter(year => isValidDateParts(year, month, day))
        .map(year => ({
            key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            time: Date.UTC(year, month, day)
        }))
        .sort((a, b) => Math.abs(a.time - referenceTime) - Math.abs(b.time - referenceTime));

    return candidates[0]?.key || '';
}

function raceDateTextMatches(dateText, date = new Date()) {
    const todayKey = getUkDateKey(date);
    return raceDateTextToKey(dateText, todayKey) === todayKey;
}

function normalizeWeatherValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isWeatherSlotSet(value) {
    const normalizedValue = normalizeWeatherValue(value);
    return normalizedValue !== '' && normalizedValue.toUpperCase() !== 'TBD';
}

function displayWeatherValue(value) {
    return normalizeWeatherValue(value) || "No data";
}

function updateWeatherSlot(index, value) {
    weatherSlotValues[index] = value;
    weatherSlotStatusKnown[index] = true;
    const display = document.getElementById(index === 0 ? 'weather1' : 'weather2');
    if (display) {
        display.textContent = displayWeatherValue(value);
        display.classList.remove('weather-result-practice');
    }
    raceWeatherAlreadySet = weatherSlotValues.every(isWeatherSlotSet);
    raceWeatherStatusKnown = weatherSlotStatusKnown.every(Boolean);
    updateRaceWeatherButtonState();
}

function updateRaceDateStatus(firebaseDate, date = new Date()) {
    const currentDate = formatDate(date);
    raceDateMatchesToday = raceDateTextMatches(firebaseDate, date);
    raceDateStatusKnown = true;

    const firebaseDateDebug = document.getElementById('firebaseDate');
    const currentDateDebug = document.getElementById('currentDate');
    const datesMatchDebug = document.getElementById('datesMatch');
    if (firebaseDateDebug) firebaseDateDebug.textContent = firebaseDate || "No data";
    if (currentDateDebug) currentDateDebug.textContent = currentDate;
    if (datesMatchDebug) datesMatchDebug.textContent = raceDateMatchesToday ? "Yes" : "No";
    updateRaceWeatherButtonState();
}

function stopLiveWeatherStatus() {
    liveWeatherRefs.forEach(({ ref, callback }) => ref.off('value', callback));
    liveWeatherRefs = [];
}

function startLiveWeatherStatus() {
    stopLiveWeatherStatus();
    raceDateStatusKnown = false;
    raceWeatherStatusKnown = false;
    weatherSlotStatusKnown = [false, false];

    const subscribe = (path, callback, failure) => {
        const ref = firebase.database().ref(path);
        ref.on('value', callback, failure);
        liveWeatherRefs.push({ ref, callback });
    };
    const failDate = error => {
        console.error('Error loading race date:', error);
        raceDateStatusKnown = false;
        updateRaceWeatherButtonState();
    };
    const failWeather = error => {
        console.error('Error loading saved weather:', error);
        raceWeatherStatusKnown = false;
        const weatherMessage = document.getElementById('weatherMessage');
        if (weatherMessage) weatherMessage.textContent = 'Unable to load saved weather. Please refresh and try again.';
        updateRaceWeatherButtonState();
    };

    subscribe('race_date', snapshot => updateRaceDateStatus(snapshot.val()), failDate);
    subscribe('weather1', snapshot => updateWeatherSlot(0, snapshot.val()), failWeather);
    subscribe('weather2', snapshot => updateWeatherSlot(1, snapshot.val()), failWeather);
}


document.addEventListener('DOMContentLoaded', () => {
    setupButtonEventListeners();
    checkWeatherDriverStatus();
});

function checkWeatherDriverStatus() {
    firebase.auth().onAuthStateChanged((user) => {
        stopLiveWeatherStatus();
        if (!user) {
            currentUserIsActiveDriver = false;
            raceDateStatusKnown = false;
            raceWeatherStatusKnown = false;
            updateRaceWeatherButtonState();
            return;
        }

        firebase.database().ref(`drivers/${user.uid}`).once('value')
            .then((snapshot) => {
                const driver = snapshot.val();
                const currentUserIsActive = !!(driver && driver.active === true);
                currentUserIsActiveDriver = currentUserIsActive;

                if (!currentUserIsActive) {
                    raceDateStatusKnown = false;
                    raceWeatherStatusKnown = false;
                    updateRaceWeatherButtonState();
                    return null;
                }

                startLiveWeatherStatus();
                return null;
            })
            .then(() => {
                updateRaceWeatherButtonState();
            })
            .catch((error) => {
                console.error("Error checking weather driver access:", error);
                currentUserIsActiveDriver = false;
                raceDateStatusKnown = false;
                raceWeatherStatusKnown = false;
                updateRaceWeatherButtonState();
            });
    });
}

function updateRaceWeatherButtonState() {
    const raceWeatherButton = document.getElementById('generateRaceWeather');
    const practiceWeatherButton = document.getElementById('generateRandomWeather');

    if (!raceWeatherButton) return;

    raceWeatherButton.disabled = true;
    raceWeatherButton.title = "";
    if (practiceWeatherButton) practiceWeatherButton.disabled = false;

    if (!currentUserIsActiveDriver) {
        raceWeatherButton.title = "Only active drivers can generate race-day weather.";
        return;
    }

    if (!raceWeatherStatusKnown) {
        raceWeatherButton.title = "Saved race weather is still loading.";
        return;
    }

    if (!raceDateStatusKnown) {
        raceWeatherButton.title = "Race date is still loading.";
        return;
    }

    if (raceWeatherAlreadySet) {
        raceWeatherButton.title = "Race weather has already been generated.";
        return;
    }

    if (!raceDateMatchesToday) {
        raceWeatherButton.title = "Race-day weather can only be generated on the race date.";
        return;
    }

    raceWeatherButton.disabled = false;
    if (practiceWeatherButton) practiceWeatherButton.disabled = true;
}

function setupButtonEventListeners() {
    const generateRandomWeatherBtn = document.getElementById('generateRandomWeather');
    const generateRaceWeatherBtn = document.getElementById('generateRaceWeather');
    const weather1Display = document.getElementById('weather1');
    const weather2Display = document.getElementById('weather2');
    const weatherMessage = document.getElementById('weatherMessage');

    if (!generateRandomWeatherBtn || !generateRaceWeatherBtn || !weather1Display || !weather2Display) return;

    generateRandomWeatherBtn.addEventListener('click', () => {
        let weather1 = generateRandomWeather();
        let weather2 = generateRandomWeather();
        weather1Display.textContent = weather1;
        weather2Display.textContent = weather2;

        // Add class for practice weather
        weather1Display.classList.add('weather-result-practice');
        weather2Display.classList.add('weather-result-practice');
    });

    generateRaceWeatherBtn.addEventListener('click', async () => {
        if (!currentUserIsActiveDriver) {
            if (weatherMessage) weatherMessage.textContent = 'Only active drivers can generate race-day weather.';
            updateRaceWeatherButtonState();
            return;
        }

        try {
            // Recheck immediately before writing so another tab cannot leave this page with stale state.
            const [dateSnapshot, snapshot1, snapshot2] = await Promise.all([
                firebase.database().ref('race_date').once('value'),
                firebase.database().ref('weather1').once('value'),
                firebase.database().ref('weather2').once('value')
            ]);
            updateRaceDateStatus(dateSnapshot.val());
            updateWeatherSlot(0, snapshot1.val());
            updateWeatherSlot(1, snapshot2.val());

            if (!raceDateMatchesToday) {
                if (weatherMessage) weatherMessage.textContent = 'Race-day weather can only be generated on the race date.';
                return;
            }

            if (isWeatherSlotSet(snapshot1.val()) && isWeatherSlotSet(snapshot2.val())) {
                raceWeatherAlreadySet = true;
                raceWeatherStatusKnown = true;
                if (weatherMessage) weatherMessage.textContent = 'Race weather has already been generated.';
                updateRaceWeatherButtonState();
                return;
            }

            const confirmGeneration = confirm("Are you sure that you want to generate the race weathers? You will be responsible for any ensuing chaos!");
            if (!confirmGeneration) return;

            generateRaceWeatherBtn.disabled = true;
            // Preserve a slot that already exists and save all missing slots in one atomic update.
            const weather1 = isWeatherSlotSet(snapshot1.val()) ? snapshot1.val() : generateRandomWeather();
            const weather2 = isWeatherSlotSet(snapshot2.val()) ? snapshot2.val() : generateRandomWeather();
            const updates = {};
            if (!isWeatherSlotSet(snapshot1.val())) updates.weather1 = weather1;
            if (!isWeatherSlotSet(snapshot2.val())) updates.weather2 = weather2;
            await firebase.database().ref().update(updates);

            updateWeatherSlot(0, weather1);
            updateWeatherSlot(1, weather2);
            if (weatherMessage) {
                weatherMessage.textContent = 'Race weathers generated! Please take a screenshot of the (probably terrible) outcome and share it with the group :)';
            }
        } catch (error) {
            console.error("Error checking saved race weather:", error);
            if (weatherMessage) weatherMessage.textContent = 'Unable to check saved weather. Please refresh and try again.';
            updateRaceWeatherButtonState();
        }
    });
}

function takeScreenshot() {
    // Get the browser window dimensions
    var width = window.innerWidth;
    var height = window.innerHeight;

    // Capture the screenshot using html2canvas
    html2canvas(document.body, {
        width: width,
        height: height,
        onrendered: function(canvas) {
            // Convert the canvas to a data URL
            var screenshotUrl = canvas.toDataURL("image/png");

            // Create a temporary link element
            var link = document.createElement("a");
            link.download = "Race Weather.png"; // Specify the filename for the downloaded image
            link.href = screenshotUrl;

            // Trigger a click event on the link to prompt download
            document.body.appendChild(link);
            link.click();

            // Cleanup: remove the link from the DOM
            document.body.removeChild(link);
        }
    });
}
