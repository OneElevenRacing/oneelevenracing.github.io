var xoyondoLink = "";
// This is the season info - UPDATE EVERY SEASON
const seasonInfo = {
    seasonNumber: 13,
    racingClass: "Formula Ultimate Gen 2",
};

// This is where the links to the car pictures for each driver are stored - UPDATE EVERY SEASON
const driverData = {
    "bkfSQcOqCOchZY5xmr0dFc2ZRp43": { //Chris
        "carImage": "Logos_and_icons/Car_Thumbnails/Chris.jpg", 
        "carName": "Chris Livery #1"
    },
    "f88AuHLw82RPilJjY620yyc4POc2": { //Fabian
        "carImage": "Logos_and_icons/Car_Thumbnails/Fabian.jpg", 
        "carName": "Lemon-Martini Racing"
    },
    "wDINxmqfqqMqZ5C4qEQyTlcZNuq1": { //Jake
        "carImage": "Logos_and_icons/Car_Thumbnails/Jake.jpg", 
        "carName": "Jake Racing"
    },
    "nXNq1RBKkFQLRy31EuFI0WE0zC83": { //Ian
        "carImage": "Logos_and_icons/Car_Thumbnails/Ian.jpg", 
        "carName": "Ian Racing"
    },
    "CE5kXCu9NFOOMtuOwMPrPPqiPb52": { //James
        "carImage": "Logos_and_icons/Car_Thumbnails/James.jpg", 
        "carName": "James Racing"
    },
    "4aRXTmu8JOQIY84ujk4pbT3Udsv2": { //Rob
        "carImage": "Logos_and_icons/Car_Thumbnails/Rob.jpg", 
        "carName": "Rob Racing"
    },
    // ... copy paste for more driver car infos ...
};

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed");

    // Define the season number and car class stuff
    document.getElementById('seasonNumber').textContent = 'Season: ' + seasonInfo.seasonNumber;
    document.getElementById('racingClass').textContent = 'Class: ' + seasonInfo.racingClass;

    // Fetch and display race info
    fetchAndUpdateRaceInfo();

    // Setup menu dropdown toggle
    setupMenuDropdown();
});

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

    // Check for user authentication and update the driver name and picture
    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            // User is signed in
            const userName = user.displayName || "Anonymous User";
            const userData = driverData[user.uid] || { "carImage": "default/car/image.png", "carName": "Default Car" };
            
            document.getElementById("driverName").innerText = userName;
            document.getElementById("raceCarImage").src = userData.carImage;
            document.getElementById("carName").innerText = userData.carName;
        } else {
            // No user is signed in
            document.getElementById("driverName").innerText = "Guest";
            document.getElementById("raceCarImage").src = "default/car/image.png";
            document.getElementById("carName").innerText = "Default Car";
        }
    });
    
}
fetchAndUpdateRaceInfo();

function openLink(url) {
    window.open(url, '_blank');
}

function navigateToHomePage() {
    // Navigate to Home Page
    window.location.href = 'main.html'; 
}

function navigateToKartingPage() {
    // Navigate to Karting Page
    window.location.href = 'main.html'; 
}

function navigateToWeatherGenerator() {
    // Navigate to Weather Generator Page
    window.location.href = 'weather.html'; // Adjust as per your weather generator page
}

function navigateToSettingsPage() {
    window.location.href = 'settings.html';
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
            event.stopPropagation(); // Prevent immediate closing
        });
    } else {
        console.log("Gear icon not found");
    }

    // Close dropdown when clicking outside
    window.onclick = function(event) {
        console.log("Window clicked");
        if (!event.target.matches('.fa-gear')) {
            var dropdowns = document.getElementsByClassName("dropdown-content");
            for (var i = 0; i < dropdowns.length; i++) {
                var openDropdown = dropdowns[i];
                if (openDropdown.classList.contains('show')) {
                    console.log("Closing dropdown");
                    openDropdown.classList.remove('show');
                }
            }
        }
    };
}

document.querySelector('.fa-gear').addEventListener('click', function(event) {
    document.getElementById('dropdown').classList.toggle('show');
    event.stopPropagation(); // Prevents the window.onclick from immediately hiding the menu
});

// Close the dropdown if clicked outside of it
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
