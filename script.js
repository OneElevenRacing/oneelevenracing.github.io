var xoyondoLink = "";

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed");

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
        document.getElementById("raceLocation").innerText = (snapshot.val() || "No data");
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

function navigateToWeatherGenerator() {
    // Navigate to Weather Generator Page
    window.location.href = 'weather.html'; // Adjust as per your weather generator page
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
