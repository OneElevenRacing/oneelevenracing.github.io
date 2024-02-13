// This is the function with all of the probabilities and weather. Make sure they add up to 1.00
function generateRandomWeather() {
    const weathers = {
        "Clear": 0.19,
        "Light Cloud": 0.124,
        "Medium Cloud": 0.124,
        "Heavy Cloud": 0.124,
        "Overcast": 0.124,
        "Light Rain": 0.083,
        "Rain": 0.041,
        "Storm": 0.024,
        "Thunderstorm": 0.024,
        "Fog": 0.024,
        "Fog with Rain": 0.016,
        "Heavy Fog with Rain": 0.008,
        "Hazy": 0.008,
        "Random": 0.014,
        "Ian's Choice": 0.008,
        "Richard's Choice": 0.008,
        "Sam's Choice": 0.008,
        "Chris' Choice": 0.008,
        "Fabian's Choice": 0.008,
        "Rob's Choice": 0.008,
        "Jake's Choice": 0.008,
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
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    const formattedDate = date.toLocaleDateString('en-US', options);
    const [weekday, month, day] = formattedDate.split(' ');

    // Append the correct suffix to the day
    const dayWithSuffix = `${parseInt(day)}${getDaySuffix(parseInt(day))}`;
    return `${weekday} ${dayWithSuffix} ${month}`;
}

function fetchAndDisplayCurrentWeather() {
    const weather1Display = document.getElementById('weather1');
    const weather2Display = document.getElementById('weather2');
    const generateRaceWeatherBtn = document.getElementById('generateRaceWeather');

    firebase.database().ref('weather1').once('value').then((snapshot1) => {
        weather1Display.textContent = snapshot1.val() || "No data";
        weather1Display.classList.remove('weather-result-practice'); // Remove practice class

        firebase.database().ref('weather2').once('value').then((snapshot2) => {
            weather2Display.textContent = snapshot2.val() || "No data";

            // Check if weathers are already generated
            if (snapshot1.val() !== "TBD" && snapshot2.val() !== "TBD") {
                generateRaceWeatherBtn.disabled = true;
            }
        });
    });
}


document.addEventListener('DOMContentLoaded', () => {
    // Fetch and display current weather from Firebase and check date
    fetchAndDisplayCurrentWeather();
    checkCurrentDateWithFirebase();

    // Event listeners for buttons
    setupButtonEventListeners();
});

function setupButtonEventListeners() {
    const generateRandomWeatherBtn = document.getElementById('generateRandomWeather');
    const generateRaceWeatherBtn = document.getElementById('generateRaceWeather');
    const weather1Display = document.getElementById('weather1');
    const weather2Display = document.getElementById('weather2');

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
        // Check if the weather is already set
        firebase.database().ref('weather1').once('value').then((snapshot) => {
            if (snapshot.val() === "TBD") {
                // Show confirmation alert
                const confirmGeneration = confirm("Are you sure that you want to generate the race weathers? You will be responsible for any ensuing chaos!");
                if (confirmGeneration) {

                    // Disable the button immediately
                    generateRaceWeatherBtn.disabled = true;

                    // Generate weathers and write to Firebase
                    let weather1 = generateRandomWeather();
                    let weather2 = generateRandomWeather();

                    firebase.database().ref('weather1').set(weather1);
                    firebase.database().ref('weather2').set(weather2);

                    weather1Display.textContent = weather1;
                    weather2Display.textContent = weather2;

                    document.getElementById('weatherMessage').textContent = 'Race weathers generated! Please take a screenshot of the (probably terrible) outcome and share it with the group. :)';

                }
            } else {
                generateRaceWeatherBtn.disabled = true; // Disable the button if weather is already set
            }
        });
    });
}



function checkCurrentDateWithFirebase() {
    console.log("Checking date with Firebase...");
    firebase.database().ref('race_date').once('value').then((snapshot) => {
        const firebaseDate = snapshot.val();
        const currentDate = formatDate(new Date());

        console.log("Firebase Date: ", firebaseDate);
        console.log("Current Date: ", currentDate);

        const raceWeatherButton = document.getElementById('generateRaceWeather');
        const practiceWeatherButton = document.getElementById('generateRandomWeather');
        if (firebaseDate === currentDate) {
            console.log("Dates match. Enabling race weather button.");
            raceWeatherButton.disabled = false;
            practiceWeatherButton.disabled = true;
        } else {
            console.log("Dates do not match. Disabling race weather button.");
            raceWeatherButton.disabled = true;
            practiceWeatherButton.disabled = false;
        }
    });
}