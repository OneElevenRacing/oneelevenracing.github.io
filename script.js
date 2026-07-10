document.addEventListener('DOMContentLoaded', function() {
    fetchAndDisplaySeasonData();
    fetchAndUpdateRaceInfo();
    setupMenuDropdown();
});

function firebaseDatabaseAvailable() {
    return typeof firebase !== 'undefined' && firebase.database;
}

function getElement(id) {
    return document.getElementById(id);
}

function setTextIfPresent(id, value) {
    const element = getElement(id);
    if (element) element.textContent = value;
}

function setValueIfPresent(id, value) {
    const element = getElement(id);
    if (element && 'value' in element) element.value = value;
}

function setImageIfPresent(id, src) {
    const element = getElement(id);
    if (element) element.src = src;
}

// This function fetches the season data and updates whichever matching page elements exist.
function fetchAndDisplaySeasonData() {
    if (!firebaseDatabaseAvailable()) return;

    const hasSeasonElements = [
        'seasonNumber',
        'racingClass',
        'currentSeasonNumber',
        'currentRacingClass'
    ].some(id => getElement(id));

    if (!hasSeasonElements) return;

    firebase.database().ref('seasonData').once('value', (snapshot) => {
        const seasonData = snapshot.val();
        if (!seasonData) return;

        setTextIfPresent('seasonNumber', seasonData.seasonNumber || '');
        setTextIfPresent('racingClass', seasonData.racingClass || '');
        setTextIfPresent('currentSeasonNumber', seasonData.seasonNumber || '');
        setTextIfPresent('currentRacingClass', seasonData.racingClass || '');
        setValueIfPresent('seasonNumber', seasonData.seasonNumber || '');
        setValueIfPresent('racingClass', seasonData.racingClass || '');
    });
}

// Function to update season data
function updateSeasonData(e) {
    if (e && e.preventDefault) e.preventDefault();
    
    const seasonNumberInput = getElement('seasonNumber');
    const racingClassInput = getElement('racingClass');

    if (!seasonNumberInput || !racingClassInput) return;

    const seasonNumber = seasonNumberInput.value;
    const racingClass = racingClassInput.value;
    
    if (!seasonNumber || !racingClass) {
        alert('Please fill in both Season Number and Racing Class');
        return;
    }
    
    const seasonRef = firebase.database().ref('seasonData');
    seasonRef.set({
        seasonNumber: seasonNumber,
        racingClass: racingClass
    }, function(error) {
        if (error) {
            alert('Error updating season data: ' + error.message);
        } else {
            alert('Season data updated successfully!');
            window.location.reload();
        }
    });
}

// This function fetches the driver data based on the user's UID and updates the HTML elements to reflect the individual user
function fetchAndDisplayDriverData(uid) {
    if (!firebaseDatabaseAvailable()) return;

    const hasDriverElements = ['driverName', 'carName', 'raceCarImage'].some(id => getElement(id));
    if (!hasDriverElements) return;

    const driversRef = firebase.database().ref('drivers/' + uid);
    driversRef.once('value', (snapshot) => {
        const driverData = snapshot.val();
        if (driverData) {
            setTextIfPresent('driverName', driverData.name || 'Unknown Driver');
            setTextIfPresent('carName', driverData.carName || 'Unknown Car');
            setImageIfPresent('raceCarImage', driverData.carImage || 'Logos_and_icons/Car_Thumbnails/placeholder.png');
        }
    });
}

// When the user's authentication state changes (i.e., they log in or out)
if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged((user) => {
        const hasDriverElements = ['driverName', 'carName', 'raceCarImage'].some(id => getElement(id));
        if (!hasDriverElements) return;

        if (user) {
            fetchAndDisplayDriverData(user.uid);
        } else {
            setTextIfPresent('driverName', 'Guest');
            setTextIfPresent('carName', 'Default Car');
            setImageIfPresent('raceCarImage', 'Logos_and_icons/Car_Thumbnails/placeholder.png');
        }
    });
}

function authorizeAndRedirect(targetUrl) {
    const user = firebase.auth().currentUser;

    if (!user) {
        alert("Please sign in first.");
        window.location.href = 'index.html';
        return;
    }

    firebase.database().ref('drivers/' + user.uid).once('value')
        .then((snapshot) => {
            const driver = snapshot.val();
            if (driver && driver.active === true && driver.isAdmin === true) {
                window.location.href = targetUrl;
            } else {
                alert("Access Denied: You must be an admin to access this page.");
            }
        })
        .catch((error) => {
            console.error("Error checking admin access:", error);
            alert("Unable to verify admin access. Please try again.");
        });
}

function fetchAndUpdateRaceInfo() {
    if (!firebaseDatabaseAvailable()) return;

    const raceElementIds = ['raceDate', 'raceLocation', 'raceTime', 'raceTrackImage'];
    if (!raceElementIds.some(id => getElement(id))) return;

    var databaseRef = firebase.database().ref();

    // Fetch and update race date
    databaseRef.child("race_date").on('value', function(snapshot) {
        setTextIfPresent("raceDate", (snapshot.val() || "No data"));
    });

    // Fetch and update race location
    databaseRef.child("race_location").on('value', function(snapshot) {
        const currentTrackName = snapshot.val() || "No data";
        setTextIfPresent("raceLocation", currentTrackName);

        // Find the corresponding image path for the current track
        const trackInfo = typeof trackData !== 'undefined'
            ? trackData.find(track => track.name === currentTrackName)
            : null;
        if (trackInfo) {
            setImageIfPresent("raceTrackImage", trackInfo.imagePath);
        } else {
            setImageIfPresent("raceTrackImage", "Logos_and_icons/racetracks/TBD.png");
        }
    });

    // Fetch and update race time
    databaseRef.child("race_time").on('value', function(snapshot) {
        setTextIfPresent("raceTime", (snapshot.val() || "No data"));
    });

    // Fetch and update weather1
    databaseRef.child("weather1").on('value', function(snapshot) {
        setTextIfPresent("weather1", (snapshot.val() || "No data"));
    });

    // Fetch and update weather2
    databaseRef.child("weather2").on('value', function(snapshot) {
        setTextIfPresent("weather2", (snapshot.val() || "No data"));
    });
}

function openLink(url) {
    window.open(url, '_blank');
}

function navigateToHomePage() {
    window.location.href = 'main.html'; 
}

function navigateToKartingPage() {
    window.location.href = 'main.html'; 
}

function navigateToWeatherGenerator() {
    window.location.href = 'weather.html';
}

function navigateToSettingsPage() {
    window.location.href = 'settings.html';
}

function goBack() {
    window.history.back();
}

function showAlert() {
    alert('Coming Soon!');
}

function setupMenuDropdown() {
    const dropdown = document.getElementById('dropdown');
    const gearIcon = document.getElementById('gearIcon') || document.querySelector('.fa-gear');

    if (gearIcon && dropdown) {
      gearIcon.addEventListener('click', function(event) {
        dropdown.classList.toggle('show');
        event.stopPropagation();
      });
    }

    window.onclick = function(event) {
        if (!event.target.matches('.fa-gear')) {
            var dropdowns = document.getElementsByClassName("dropdown-content");
            for (var i = 0; i < dropdowns.length; i++) {
                var openDropdown = dropdowns[i];
                if (openDropdown.classList.contains('show')) {
                    openDropdown.classList.remove('show');
                }
            }
        }
    };
}
