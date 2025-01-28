var xoyondoLink = "";

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed");

    // Fetch and display season information
    fetchAndDisplaySeasonData();

    // Fetch and display race info
    fetchAndUpdateRaceInfo();

    // Setup menu dropdown toggle
    setupMenuDropdown();
});


// This function fetches the season data and updates the HTML elements
function fetchAndDisplaySeasonData() {
    const seasonRef = firebase.database().ref('seasonData');
    seasonRef.once('value', (snapshot) => {
        const seasonData = snapshot.val();
        if (seasonData) {
    // Update the display text
    document.getElementById('seasonNumber').textContent = seasonData.seasonNumber;
    document.getElementById('racingClass').textContent = seasonData.racingClass;
    document.getElementById('currentSeasonNumber').textContent = seasonData.seasonNumber;
    document.getElementById('currentRacingClass').textContent = seasonData.racingClass;
            
            // Populate the input fields with current values
            document.getElementById('seasonNumber').value = seasonData.seasonNumber;
            document.getElementById('racingClass').value = seasonData.racingClass;
            
        }
    });
}

// Function to update season data
function updateSeasonData() {
    event.preventDefault();
    
    const seasonNumber = document.getElementById('seasonNumber').value;
    const racingClass = document.getElementById('racingClass').value;
    
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
    const driversRef = firebase.database().ref('drivers/' + uid);
    driversRef.once('value', (snapshot) => {
        const driverData = snapshot.val();
        if (driverData) {
            // Assuming you have elements with ID 'driverName', 'carName', and 'raceCarImage' in your HTML
            document.getElementById('driverName').textContent = driverData.name || 'Unknown Driver';
            document.getElementById('carName').textContent = driverData.carName || 'Unknown Car';
            document.getElementById('raceCarImage').src = driverData.carImage || 'Logos_and_icons/Car_Thumbnails/placeholder.png';
        }
    });
}

// When the user's authentication state changes (i.e., they log in or out)
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        // User is logged in, fetch and display their driver data
        fetchAndDisplayDriverData(user.uid);
    } else {
        // User is not logged in, show default or guest data
        document.getElementById('driverName').textContent = 'Guest';
        document.getElementById('carName').textContent = 'Default Car';
        document.getElementById('raceCarImage').src = 'Logos_and_icons/Car_Thumbnails/placeholder.png';
    }
});

function authorizeAndRedirect(targetUrl) {
    // Get the currently authenticated user
    var user = firebase.auth().currentUser;

    // Specify the authorized user IDs
    var authorizedUserIDs = ["bkfSQcOqCOchZY5xmr0dFc2ZRp43", "f88AuHLw82RPilJjY620yyc4POc2" /* Add more user IDs as needed */];

    // Check if the user is authenticated and their UID is in the authorized list
    if (user && authorizedUserIDs.includes(user.uid)) {
        // User is authorized, redirect to the target URL
        window.location.href = targetUrl;
    } else {
        // User is not authorized, show a message or handle it as needed
        alert("Access Denied: You are not authorized to access this page.");
    }
}

function fetchAndUpdateRaceInfo() {
    var databaseRef = firebase.database().ref();

    // Fetch and update race date
    databaseRef.child("race_date").on('value', function(snapshot) {
        document.getElementById("raceDate").innerText = (snapshot.val() || "No data");
    });

    // Fetch and update race location
    databaseRef.child("race_location").on('value', function(snapshot) {
        const currentTrackName = snapshot.val() || "No data";
        document.getElementById("raceLocation").innerText = currentTrackName;

        // Find the corresponding image path for the current track
        const trackInfo = trackData.find(track => track.name === currentTrackName);
        if (trackInfo) {
            // Update the image source
            document.getElementById("raceTrackImage").src = trackInfo.imagePath;
            console.log("Image path found: ", trackInfo.imagePath);
        } else {
            // Fallback in case no track matches
            document.getElementById("raceTrackImage").src = "Logos_and_icons/racetracks/TBD.png";
        }
    });

    // Fetch and update race time
    databaseRef.child("race_time").on('value', function(snapshot) {
        document.getElementById("raceTime").innerText = (snapshot.val() || "No data");
    });

    // Fetch and update weather1
    databaseRef.child("weather1").on('value', function(snapshot) {
        document.getElementById("weather1").innerText = (snapshot.val() || "No data");
    });

    // Fetch and update weather2
    databaseRef.child("weather2").on('value', function(snapshot) {
        document.getElementById("weather2").innerText = (snapshot.val() || "No data");
    });

    // Fetch and update Xoyondo link
    databaseRef.child("xoyondo_link").once('value', function(snapshot) {
        xoyondoLink = snapshot.val() || "https://example.com/race-availability";
        // Update the button's onclick attribute with the fetched link
        document.querySelector('button[onclick*="race-availability"]').setAttribute('onclick', `openLink('${xoyondoLink}')`);
    });
}

fetchAndUpdateRaceInfo();

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
    console.log("Setting up menu dropdown");

    const gearIcon = document.querySelector('.fa-gear');
    if (gearIcon) {
        gearIcon.addEventListener('click', function(event) {
            console.log("Gear icon clicked");
            document.getElementById('dropdown').classList.toggle('show');
            event.stopPropagation();
        });
    } else {
        console.log("Gear icon not found");
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
