document.addEventListener('DOMContentLoaded', function() {
    populateTrackOptions();
    // ... other initialization code ...
});

// This function creates the track list
function populateTrackOptions() {
    let tracks = [
        "TBD",
        "Special Event",
        "Adelaide",
        "Adelaide 1988",
        "Azure Circuit",
        "Barcelona GP",
        "Barcelona GP (No Chicane)",
        "Bathurst 2020",
        "Brands Hatch",
        "Brands Hatch Indy",
        "Brasilia",
        "Brasilia Outer (like an oval)",
        "Buenos Aires Circuito No.6 S",
        "Buenos Aires Circuito No.6",
        "Buenos Aires Circuito No.8",
        "Buenos Aires Circuito No.9",
        "Buenos Aires Circuito No.12",
        "Buenos Aires Circuito No.15",
        "Cadwell Park",
        "Campo Grande",
        "Cascais",
        "Cascais Alternate",
        "Cascavel",
        "Cleveland GP",
        "Cordoba No.4",
        "Cordoba TC",
        "Cordoba No.2",
        "Curitiba",
        "Curvelo Long",
        "Curvelo Short",
        "Daytona Sports Car Course",
        "Daytona Nascar Road Course",
        "Donington GP",
        "Donington National",
        "Fontana Sports Car Course",
        "Galeao Airport",
        "Gateway Road Course (Short)",
        "Gateway Road Course (Long)",
        "Goiania",
        "Goiania Short",
        "Goiania External (like an oval)",
        "Guapore",
        "Hockenheim",
        "Hockenheim National",
        "Hockenheim Short A",
        "Hockenheim Short B",
        "Hockenheim Historic 2001",
        "Hockenheim Historic 1988",
        "Hockenheim Historic 1988 Short",
        "Hockenheim Historic 1977",
        "Yahuacocha (Ibarra)",
        "Yahuacocha Reverse (Ibarra)",
        "Imola",
        "Imola 2001",
        "Imola 1988",
        "Imola 1972",
        "Interlagos GP",
        "Interlagos Historic 1976",
        "Jacarepagua 2005",
        "Jacarepagua 1988",
        "Jacarepagua 2012 SCB",
        "Jacarepagua 2012 Short",
        "Jerez Moto",
        "Jerez Chicane",
        "Kansai GP",
        "Kansai West",
        "Kansai East",
        "Kyalami",
        "Kyalami 1976",
        "Laguna Seca 2020",
        "Londrina Short",
        "Londrina Long",
        "Long Beach",
        "Montreal",
        "Montreal 1988",
        "Monza",
        "Monza Junior",
        "Monza Historic 1991",
        "Monza Historic 1971",
        "Monza Historic 1971 Junior",
        "Monza Historic 1971 10k",
        "Nürburgring GP 2020",
        "Nürburgring Sprint 2020",
        "Nürburgring Sprint S 2020",
        "Oulton Park International",
        "Oulton Park Island",
        "Oulton Park Fosters",
        "Oulton Park Classic",
        "Road America",
        "Road America (Bend)",
        "Salvador Street Circuit",
        "Santa Cruz do Sul",
        "Silverstone",
        "Silverstone International",
        "Silverstone National",
        "Silverstone Historic 2001",
        "Silverstone National Historic 2001",
        "Silverstone Historic 1991",
        "Silverstone Historic 1975",
        "Silverstone Historic 1975 (no chicane)",
        "Snetterton 300",
        "Snetterton 200",
        "Spa-Francorchamps 2022",
        "Spa-Francorchamps 2020",
        "Spa-Francorchamps Historic 1993",
        "Spielberg",
        "Spielberg Short",
        "Spielberg 1974",
        "Spielberg 1977",
        "Taruma Internacional",
        "Taruma Chicane",
        "Termas de Rio Hondo",
        "Velo Citta",
        "Velo Citta Track Day",
        "Velo Citta Club Day",
        "Velopark 2017",
        "Velopark 2010",
        "Virginia International Raceway Full",
        "Virginia International Raceway Grand",
        "Virginia International Raceway North",
        "Virginia International Raceway South",
        "Watkins Glen GP",
        "Watkins Glen GP (Inner Loop)",
        "Watkins Glen Short",
        "Watkins Glen Short (Inner Loop)"
        ];

    let selectElement = document.getElementById('raceTrackSelect');
    tracks.forEach(track => {
        let option = document.createElement('option');
        option.value = track;
        option.textContent = track;
        selectElement.appendChild(option);
    });
}

function fetchCurrentData() {
    // Fetch and display current race location
    firebase.database().ref('race_location').once('value').then(snapshot => {
        const currentTrack = snapshot.val() || 'TBD';
        document.getElementById('raceTrackSelect').value = currentTrack;
        document.getElementById('currentRaceTrack').textContent = currentTrack;
    });

    // Fetch and display current race date
    firebase.database().ref('race_date').once('value').then(snapshot => {
        const currentDate = snapshot.val();
        if (currentDate && currentDate !== "TBD") {
            document.getElementById('raceDate').value = convertToInputDateFormat(currentDate);
        } else {
            document.getElementById('raceDate').value = new Date().toISOString().split('T')[0];
        }
        document.getElementById('currentRaceDate').textContent = currentDate || 'TBD';
    });

    // Fetch and display current race time
    firebase.database().ref('race_time').once('value').then(snapshot => {
        const currentTime = snapshot.val();
        if (currentTime && currentTime !== "TBD") {
            document.getElementById('raceTime').value = convertTo24HourFormat(currentTime);
        } else {
            document.getElementById('raceTime').value = "19:00";
        }
        document.getElementById('currentRaceTime').textContent = currentTime || 'TBD';
    });

    // Fetch and display current Xoyondo link
    firebase.database().ref('xoyondo_link').once('value').then(snapshot => {
        const currentLink = snapshot.val() || 'Not set';
        document.getElementById('xoyondoLink').value = currentLink;
        document.getElementById('currentXoyondoLink').textContent = currentLink;
    });
}

// Utility function to convert date from "Day, xth Month" format to "yyyy-mm-dd" format
function convertToInputDateFormat(dateString) {
    const [dayName, day, month] = dateString.split(' ');
    const year = new Date().getFullYear(); // Assuming current year
    const formattedDate = new Date(`${day} ${month} ${year}`).toISOString().split('T')[0];
    return formattedDate;
}

// Utility function to convert time from "h.mmam/pm" format to "HH:MM" format
function convertTo24HourFormat(timeString) {
    let [time, modifier] = timeString.split(/(am|pm)/i);
    let [hours, minutes] = time.split('.');
    hours = hours % 12;
    if (modifier.toLowerCase() === 'pm') {
        hours = hours + 12;
    }
    return `${String(hours).padStart(2, '0')}:${minutes}`;
}


// Call fetchCurrentData along with other initialization code
document.addEventListener('DOMContentLoaded', function() {
    populateTrackOptions();
    fetchCurrentData();
    // ... other initialization code ...
});


//Submitting the race data bits
//All at once
function submitRaceData() {
    submitRaceTrack();
    submitRaceDate();
    submitRaceTime();
}


//Submitting the race Track
function submitRaceTrack() {
    // Get the selected race track from the dropdown
    var selectedTrack = document.getElementById('raceTrackSelect').value;

    // Reference your Firebase database
    var databaseRef = firebase.database().ref();

    // Write the selected race track to the 'race_location' node in your Firebase database
    databaseRef.child('race_location').set(selectedTrack)
        .then(function() {
            console.log('Race track updated successfully!');

            // Update the displayed current race track
            document.getElementById('currentRaceTrack').textContent = selectedTrack;

            // You can also show a confirmation message to the user
        })
        .catch(function(error) {
            console.log('Error updating race track: ', error);
            // Handle errors here (e.g., show an error message)
        });
}

//Submitting the Race Date
function submitRaceDate() {
    var dateInput = document.getElementById('raceDate').value;
    var formattedDate = formatDateToDayMonth(dateInput);

    // Reference your Firebase database
    var databaseRef = firebase.database().ref();

    // Write the formatted race date to the 'race_date' node in your Firebase database
    databaseRef.child('race_date').set(formattedDate)
        .then(function() {
            console.log('Race date updated successfully!');
            document.getElementById('currentRaceDate').textContent = formattedDate;
        })
        .catch(function(error) {
            console.log('Error updating race date: ', error);
            // Handle errors here (e.g., show an error message)
        });
}

// Converting the date to the correct style
function formatDateToDayMonth(dateString) {
    var date = new Date(dateString);
    var options = { weekday: 'long', month: 'long', day: 'numeric' };
    var formattedDate = date.toLocaleDateString('en-US', options);

    var parts = formattedDate.split(' ');
    var day = parseInt(parts[2]); // Get the day as an integer
    var dayWithSuffix = day + getDaySuffix(day);

    return parts[0] + ' ' + dayWithSuffix + ' ' + parts[1]; // Construct the date string
}

function getDaySuffix(day) {
    if (day > 3 && day < 21) return 'th'; // for teens
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

//Race Time
function submitRaceTime() {
    var timeInput = document.getElementById('raceTime').value;
    var formattedTime = convertTo12HourFormat(timeInput);

    // Submit to Firebase
    firebase.database().ref('race_time').set(formattedTime).then(() => {
        // Update the current race time display
        document.getElementById('currentRaceTime').textContent = formattedTime;
    }).catch((error) => {
        console.error("Error updating race time: ", error);
    });
}
// Converting the time to the correct format
function convertTo12HourFormat(time) {
    var [hours, minutes] = time.split(':');
    var hoursInt = parseInt(hours);
    var suffix = hoursInt >= 12 ? 'pm' : 'am';
    var convertedHours = ((hoursInt + 11) % 12 + 1); // Convert to 12-hour format
    return `${convertedHours}.${minutes}${suffix}`;
}

//Xoyondo Link
function submitXoyondoLink() {
    var currentXoyondoLink = document.getElementById('xoyondoLink').value;

    // Submit to Firebase
    firebase.database().ref('xoyondo_link').set(currentXoyondoLink).then(() => {
        // Update the current xoyondo link display
        document.getElementById('currentXoyondoLink').textContent = currentXoyondoLink;
    }).catch((error) => {
        console.error("Error updating Xoyondo link: ", error);
    });
}

//reset button functions
function resetWeather() {
    const weatherResetValue = "TBD";

    firebase.database().ref('weather1').set(weatherResetValue);
    firebase.database().ref('weather2').set(weatherResetValue);
}


function resetAll() {
    const resetValue = "TBD";

    firebase.database().ref('race_date').set(resetValue).then(() => {
        document.getElementById('currentRaceDate').textContent = resetValue;
    });
    firebase.database().ref('race_time').set(resetValue).then(() => {
        document.getElementById('currentRaceTime').textContent = resetValue;
    });
    firebase.database().ref('weather1').set(resetValue);
    firebase.database().ref('weather2').set(resetValue);
}

function setDateTBD() {
    const tbdValue = "TBD";

    firebase.database().ref('race_date').set(tbdValue).then(() => {
        document.getElementById('currentRaceDate').textContent = tbdValue;
    }).catch((error) => {
        console.error("Error setting race date to TBD: ", error);
    });
}

function setTimeTBD() {
    const tbdValue = "TBD";

    firebase.database().ref('race_time').set(tbdValue).then(() => {
        document.getElementById('currentRaceTime').textContent = tbdValue;
    }).catch((error) => {
        console.error("Error setting race time to TBD: ", error);
    });
}
