let currentUserIsActiveDriver = false;
let raceDateMatchesToday = false;
let raceWeatherAlreadySet = false;
let raceDateStatusKnown = false;
let raceWeatherStatusKnown = false;

const WEEKDAY_ABBRS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    const day = date.getDate();
    return `${WEEKDAY_ABBRS[date.getDay()]}, ${day}${getDaySuffix(day)} ${MONTH_ABBRS[date.getMonth()]}`;
}

function normalizeRaceDateText(dateText) {
    return String(dateText || '')
        .trim()
        .replace(/,/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function raceDateTextMatches(dateA, dateB) {
    return normalizeRaceDateText(dateA) === normalizeRaceDateText(dateB);
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

function fetchAndDisplayCurrentWeather() {
    const weather1Display = document.getElementById('weather1');
    const weather2Display = document.getElementById('weather2');
    const weatherMessage = document.getElementById('weatherMessage');

    if (!weather1Display || !weather2Display) return Promise.resolve();

    return Promise.all([
        firebase.database().ref('weather1').once('value'),
        firebase.database().ref('weather2').once('value')
    ]).then(([snapshot1, snapshot2]) => {
        const weather1 = snapshot1.val();
        const weather2 = snapshot2.val();

        weather1Display.textContent = displayWeatherValue(weather1);
        weather1Display.classList.remove('weather-result-practice'); // Remove practice class
        weather2Display.textContent = displayWeatherValue(weather2);
        weather2Display.classList.remove('weather-result-practice');

        raceWeatherAlreadySet = isWeatherSlotSet(weather1) && isWeatherSlotSet(weather2);
        raceWeatherStatusKnown = true;
        updateRaceWeatherButtonState();
    }).catch((error) => {
        console.error("Error fetching current weather:", error);
        raceWeatherStatusKnown = false;
        if (weatherMessage) weatherMessage.textContent = 'Unable to load saved weather. Please refresh and try again.';
        updateRaceWeatherButtonState();
    });
}


document.addEventListener('DOMContentLoaded', () => {
    setupButtonEventListeners();
    checkWeatherDriverStatus();
});

function checkWeatherDriverStatus() {
    firebase.auth().onAuthStateChanged((user) => {
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

                return Promise.all([
                    fetchAndDisplayCurrentWeather(),
                    checkCurrentDateWithFirebase()
                ]);
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

    generateRaceWeatherBtn.addEventListener('click', () => {
        if (!currentUserIsActiveDriver) {
            if (weatherMessage) weatherMessage.textContent = 'Only active drivers can generate race-day weather.';
            updateRaceWeatherButtonState();
            return;
        }

        if (!raceDateMatchesToday) {
            if (weatherMessage) weatherMessage.textContent = 'Race-day weather can only be generated on the race date.';
            updateRaceWeatherButtonState();
            return;
        }

        // Check if the weather is already set
        Promise.all([
            firebase.database().ref('weather1').once('value'),
            firebase.database().ref('weather2').once('value')
        ]).then(([snapshot1, snapshot2]) => {
            if (!isWeatherSlotSet(snapshot1.val()) || !isWeatherSlotSet(snapshot2.val())) {
                // Show confirmation alert
                const confirmGeneration = confirm("Are you sure that you want to generate the race weathers? You will be responsible for any ensuing chaos!");
                if (confirmGeneration) {

                    // Disable the button immediately
                    generateRaceWeatherBtn.disabled = true;

                    // Generate weathers and write to Firebase
                    let weather1 = generateRandomWeather();
                    let weather2 = generateRandomWeather();

                    Promise.all([
                        firebase.database().ref('weather1').set(weather1),
                        firebase.database().ref('weather2').set(weather2)
                    ]).then(() => {
                        raceWeatherAlreadySet = true;
                        raceWeatherStatusKnown = true;
                        weather1Display.textContent = weather1;
                        weather2Display.textContent = weather2;
                        if (weatherMessage) {
                            weatherMessage.textContent = 'Race weathers generated! Please take a screenshot of the (probably terrible) outcome and share it with the group :)';
                        }
                        updateRaceWeatherButtonState();
                    }).catch((error) => {
                        console.error("Error saving race weather:", error);
                        if (weatherMessage) weatherMessage.textContent = 'Failed to save race weather. Please check active driver access and try again.';
                        updateRaceWeatherButtonState();
                    });

                }
            } else {
                raceWeatherAlreadySet = true;
                raceWeatherStatusKnown = true;
                if (weatherMessage) weatherMessage.textContent = 'Race weather has already been generated.';
                updateRaceWeatherButtonState();
            }
        }).catch((error) => {
            console.error("Error checking saved race weather:", error);
            if (weatherMessage) weatherMessage.textContent = 'Unable to check saved weather. Please refresh and try again.';
            updateRaceWeatherButtonState();
        });
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




function checkCurrentDateWithFirebase() {
    console.log("Checking date with Firebase...");
    return firebase.database().ref('race_date').once('value').then((snapshot) => {
        const firebaseDate = snapshot.val();
        const currentDate = formatDate(new Date());

        console.log("Firebase Date: ", firebaseDate);
        console.log("Current Date: ", currentDate);

        const firebaseDateDebug = document.getElementById('firebaseDate');
        const currentDateDebug = document.getElementById('currentDate');
        const datesMatchDebug = document.getElementById('datesMatch');

        raceDateMatchesToday = raceDateTextMatches(firebaseDate, currentDate);
        raceDateStatusKnown = true;
        if (firebaseDateDebug) firebaseDateDebug.textContent = firebaseDate || "No data";
        if (currentDateDebug) currentDateDebug.textContent = currentDate;
        if (datesMatchDebug) datesMatchDebug.textContent = raceDateMatchesToday ? "Yes" : "No";

        updateRaceWeatherButtonState();
    }).catch((error) => {
        console.error("Error checking race date:", error);
        raceDateMatchesToday = false;
        raceDateStatusKnown = false;
        updateRaceWeatherButtonState();
    });
}
