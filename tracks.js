document.addEventListener('DOMContentLoaded', function () {
    const currentPage = window.location.pathname;
  
    // Only call populateTrackOptions() on pages that need it
    if (currentPage.includes("poll_admin.html") || currentPage.includes("main.html")) {
      populateTrackOptions();
    }
  });

// the list of tracks with their corresponding image locations, stored as an array
const trackData = [
    { name: "TBD", shortName: "TBD", imagePath: "Logos_and_icons/racetracks/TBD.png" },
    { name: "Special Event", shortName: "Special", imagePath: "Logos_and_icons/racetracks/Special_Event.png" },
    { name: "Adelaide", shortName: "Adelaide", imagePath: "Logos_and_icons/racetracks/Adelaide.png" },
    { name: "Adelaide 1988", shortName: "Adelaide", imagePath: "Logos_and_icons/racetracks/Adelaide_1988.png" },
    { name: "Azure Circuit", shortName: "Azure", imagePath: "Logos_and_icons/racetracks/Azure_Circuit.png" },
    { name: "Barcelona GP", shortName: "Barcelona", imagePath: "Logos_and_icons/racetracks/Barcelona_GP.png" },
    { name: "Barcelona GP (No Chicane)", shortName: "Barcelona", imagePath: "Logos_and_icons/racetracks/Barcelona_GP_No_Chicane.png" },
    { name: "Barcelona National", shortName: "Barcelona", imagePath: "Logos_and_icons/racetracks/Barcelona-Nat-2023.png" },
    { name: "Barcelona 1991", shortName: "Barcelona", imagePath: "Logos_and_icons/racetracks/Catalunya91.png" },
    { name: "Bathurst 2020", shortName: "Bathurst", imagePath: "Logos_and_icons/racetracks/Bathurst_2020.png" },
    { name: "Bathurst 1983", shortName: "Bathurst", imagePath: "Logos_and_icons/racetracks/MountPanorama38.png" },
    { name: "Brands Hatch", shortName: "Brands Hatch", imagePath: "Logos_and_icons/racetracks/Brands_Hatch.png" },
    { name: "Brands Hatch Indy", shortName: "Brands Hatch", imagePath: "Logos_and_icons/racetracks/Brands_Hatch_Indy.png" },
    { name: "Brasilia", shortName: "Brasilia", imagePath: "Logos_and_icons/racetracks/Brasilia.png" },
    { name: "Brasilia Outer (like an oval)", shortName: "Brasilia", imagePath: "Logos_and_icons/racetracks/Brasilia_Outer.png" },
    { name: "Buenos Aires Circuito No.6 S", shortName: "Buenos Aires", imagePath: "Logos_and_icons/racetracks/Buenos_Aires_6S.png" },
    { name: "Buenos Aires Circuito No.6", shortName: "Buenos Aires", imagePath: "Logos_and_icons/racetracks/Buenos_Aires_6.png" },
    { name: "Buenos Aires Circuito No.8", shortName: "Buenos Aires", imagePath: "Logos_and_icons/racetracks/Buenos_Aires_8.png" },
    { name: "Buenos Aires Circuito No.9", shortName: "Buenos Aires", imagePath: "Logos_and_icons/racetracks/Buenos_Aires_9.png" },
    { name: "Buenos Aires Circuito No.12", shortName: "Buenos Aires", imagePath: "Logos_and_icons/racetracks/Buenos_Aires_12.png" },
    { name: "Buenos Aires Circuito No.15", shortName: "Buenos Aires", imagePath: "Logos_and_icons/racetracks/Buenos_Aires_15.png" },
    { name: "Cadwell Park", shortName: "Cadwell Park", imagePath: "Logos_and_icons/racetracks/Cadwell_Park.png" },
    { name: "Campo Grande", shortName: "Campo Grande", imagePath: "Logos_and_icons/racetracks/Campo_Grande.png" },
    { name: "Cascais", shortName: "Cascais", imagePath: "Logos_and_icons/racetracks/Cascais.png" },
    { name: "Cascais Alternate", shortName: "Cascais", imagePath: "Logos_and_icons/racetracks/Cascais_Alternate.png" },
    { name: "Cascais 1988", shortName: "Cascais", imagePath: "Logos_and_icons/racetracks/Estoril72.png" },
    { name: "Cascavel", shortName: "Cascavel", imagePath: "Logos_and_icons/racetracks/Cascavel.png" },
    { name: "Cleveland GP", shortName: "Cleveland", imagePath: "Logos_and_icons/racetracks/Cleveland_GP.png" },
    { name: "Cordoba No.4", shortName: "Cordoba", imagePath: "Logos_and_icons/racetracks/Cordoba_No4.png" },  
    { name: "Cordoba TC", shortName: "Cordoba", imagePath: "Logos_and_icons/racetracks/Cordoba_TC.png" },
    { name: "Cordoba No.2", shortName: "Cordoba", imagePath: "Logos_and_icons/racetracks/Cordoba_No_2.png" },
    { name: "Curitiba", shortName: "Curitiba", imagePath: "Logos_and_icons/racetracks/Curitiba.png" },
    { name: "Curvelo Long", shortName: "Curvelo", imagePath: "Logos_and_icons/racetracks/Curvelo_Long.png" },
    { name: "Curvelo Short", shortName: "Curvelo", imagePath: "Logos_and_icons/racetracks/Curvelo_Short.png" },
    { name: "Daytona Sports Car Course", shortName: "Daytona", imagePath: "Logos_and_icons/racetracks/Daytona_Sports_Car_Course.png" },
    { name: "Daytona Nascar Road Course", shortName: "Daytona", imagePath: "Logos_and_icons/racetracks/Daytona_Nascar_Road_Course.png" },
    { name: "Donington GP", shortName: "Donington", imagePath: "Logos_and_icons/racetracks/Donington_GP.png" },
    { name: "Donington National", shortName: "Donington", imagePath: "Logos_and_icons/racetracks/Donington_National.png" },
    { name: "Fontana Sports Car Course", shortName: "Fontana", imagePath: "Logos_and_icons/racetracks/Fontana_Sports_Car_Course.png" },
    { name: "Galeao Airport", shortName: "Galeao", imagePath: "Logos_and_icons/racetracks/Galeao_Airport.png" },
    { name: "Gateway WWT Road Course (Short)", shortName: "Gateway", imagePath: "Logos_and_icons/racetracks/Gateway_Road_Course_Short.png" },
    { name: "Gateway WWT Road Course (Long)", shortName: "Gateway", imagePath: "Logos_and_icons/racetracks/Gateway_Road_Course_Long.png" },
    { name: "Goiania", shortName: "Goiania", imagePath: "Logos_and_icons/racetracks/Goiania.png" },
    { name: "Goiania Short", shortName: "Goiania", imagePath: "Logos_and_icons/racetracks/Goiania_Short.png" },
    { name: "Goiania External (like an oval)", shortName: "Goiania", imagePath: "Logos_and_icons/racetracks/Goiania_External.png" },
    { name: "Guapore", shortName: "Guapore", imagePath: "Logos_and_icons/racetracks/Guapore.png" },
    { name: "Hockenheim", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim.png" },
    { name: "Hockenheim National", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_National.png" },
    { name: "Hockenheim Short A", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_Short_A.png" },
    { name: "Hockenheim Short B", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_Short_B.png" },
    { name: "Hockenheim 2001", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_Historic_2001.png" },
    { name: "Hockenheim 1988", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_Historic_1988.png" },
    { name: "Hockenheim 1988 Short", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_Historic_1988_Short.png" },
    { name: "Hockenheim 1977", shortName: "Hockenheim", imagePath: "Logos_and_icons/racetracks/Hockenheim_Historic_1977.png" },
    { name: "Yahuacocha (Ibarra)", shortName: "Ibarra", imagePath: "Logos_and_icons/racetracks/Yahuacocha_Ibarra.png" },
    { name: "Yahuacocha Reverse (Ibarra)", shortName: "Ibarra", imagePath: "Logos_and_icons/racetracks/Yahuacocha_Reverse_Ibarra.png" },  
    { name: "Imola", shortName: "Imola", imagePath: "Logos_and_icons/racetracks/Imola.png" },
    { name: "Imola 2001", shortName: "Imola", imagePath: "Logos_and_icons/racetracks/Imola_2001.png" },
    { name: "Imola 1988", shortName: "Imola", imagePath: "Logos_and_icons/racetracks/Imola_1988.png" },
    { name: "Imola 1972", shortName: "Imola", imagePath: "Logos_and_icons/racetracks/Imola_1972.png" },
    { name: "Indianapolis Road Course", shortName: "Indianapolis", imagePath: "Logos_and_icons/racetracks/IndianapolisRC 14.png" },
    { name: "Interlagos GP", shortName: "Interlagos", imagePath: "Logos_and_icons/racetracks/Interlagos_GP.png" },
    { name: "Interlagos Stock Car Brasil", shortName: "Interlagos", imagePath: "Logos_and_icons/racetracks/Interlagos_GP.png" },
    { name: "Interlagos 1993", shortName: "Interlagos", imagePath: "Logos_and_icons/racetracks/Interlagos-1992.png" },
    { name: "Interlagos 1991", shortName: "Interlagos", imagePath: "Logos_and_icons/racetracks/Interlagos-1990.png" },
    { name: "Interlagos 1976", shortName: "Interlagos", imagePath: "Logos_and_icons/racetracks/Interlagos_Historic_1976.png" },
    { name: "Jacarepagua 2005", shortName: "Jacarepagua", imagePath: "Logos_and_icons/racetracks/Jacarepagua_2005.png" },
    { name: "Jacarepagua 1988", shortName: "Jacarepagua", imagePath: "Logos_and_icons/racetracks/Jacarepagua_1988.png" },
    { name: "Jacarepagua 2012 SCB", shortName: "Jacarepagua", imagePath: "Logos_and_icons/racetracks/Jacarepagua_2012_SCB.png" },
    { name: "Jacarepagua 2012 Short", shortName: "Jacarepagua", imagePath: "Logos_and_icons/racetracks/Jacarepagua_2012_Short.png" },
    { name: "Jerez Moto", shortName: "Jerez", imagePath: "Logos_and_icons/racetracks/Jerez_Moto.png" },
    { name: "Jerez Chicane", shortName: "Jerez", imagePath: "Logos_and_icons/racetracks/Jerez_Chicane.png" },
    { name: "Jerez 1988", shortName: "Jerez", imagePath: "Logos_and_icons/racetracks/Jerez85.png" },
    { name: "Kansai GP", shortName: "Kansai", imagePath: "Logos_and_icons/racetracks/Kansai_GP.jpg" },
    { name: "Kansai West", shortName: "Kansai", imagePath: "Logos_and_icons/racetracks/Kansai_West.jpg" },
    { name: "Kansai East", shortName: "Kansai", imagePath: "Logos_and_icons/racetracks/Kansai_East.jpg" },
    { name: "Kansai Classic", shortName: "Kansai", imagePath: "Logos_and_icons/racetracks/Kansai_GP.jpg" },
    { name: "Kyalami", shortName: "Kyalami", imagePath: "Logos_and_icons/racetracks/Kyalami.png" },
    { name: "Kyalami 1976", shortName: "Kyalami", imagePath: "Logos_and_icons/racetracks/Kyalami_1976.png" },
    { name: "Laguna Seca 2020", shortName: "Laguna Seca", imagePath: "Logos_and_icons/racetracks/Laguna_Seca_2020.png" },
    { name: "Le Mans 24H", shortName: "Le Mans 24h", imagePath: "Logos_and_icons/racetracks/Le-Mans-Sarthe15.png" },
    { name: "Le Mans Bugatti", shortName: "Le Mans", imagePath: "Logos_and_icons/racetracks/Le-Mans-Bugatti-15.png" },
    { name: "Londrina Short", shortName: "Londrina", imagePath: "Logos_and_icons/racetracks/Londrina_Short.png" },
    { name: "Londrina Long", shortName: "Londrina", imagePath: "Logos_and_icons/racetracks/Londrina_Long.png" },
    { name: "Long Beach", shortName: "Long Beach", imagePath: "Logos_and_icons/racetracks/Long_Beach.png" },
    { name: "Montreal", shortName: "Montreal", imagePath: "Logos_and_icons/racetracks/Montreal.png" },
    { name: "Montreal 1991", shortName: "Montreal", imagePath: "Logos_and_icons/racetracks/Montreal-Gilles-Villeneuve-1991.png" },
    { name: "Montreal 1988", shortName: "Montreal", imagePath: "Logos_and_icons/racetracks/Montreal_1988.png" },
    { name: "Monza", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/Monza.png" },
    { name: "Monza Junior", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/Monza_Junior.png" },
    { name: "Monza 1991", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/Monza_Historic_1991.png" },
    { name: "Monza 1971", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/Monza_Historic_1971.png" },
    { name: "Monza 1971 Junior", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/Monza_Historic_1971_Junior.png" },
    { name: "Monza 1971 10k", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/Monza_Historic_1971_10k.png" },
    { name: "Monza 1971 10K (No Chicane)", shortName: "Monza", imagePath: "Logos_and_icons/racetracks/MonzaFull59.png" },
    { name: "Mosport", shortName: "Mosport", imagePath: "Logos_and_icons/racetracks/Mosport.png" },
    { name: "Nürburgring 1971 Beton", shortName: "Nürburgring", imagePath: "Logos_and_icons/racetracks/Nurburgring-Betonschleife-69-72.png" },
    { name: "Nürburgring GP 2020", shortName: "Nürburgring", imagePath: "Logos_and_icons/racetracks/Nurburgring_GP_2020.png" },
    { name: "Nürburgring Sprint 2020", shortName: "Nürburgring", imagePath: "Logos_and_icons/racetracks/Nurburgring_Sprint_2020.png" },
    { name: "Nürburgring Sprint S 2020", shortName: "Nürburgring", imagePath: "Logos_and_icons/racetracks/Nurburgring_Sprint_S_2020.png" },
    { name: "Nurburgring Sudschleife 1971", shortName: "Nürburgring", imagePath: "Logos_and_icons/racetracks/Nurburgring-Sudschleife-69-72.png" },
    { name: "Oulton Park International", shortName: "Oulton Park", imagePath: "Logos_and_icons/racetracks/Oulton_Park_International.png" },
    { name: "Oulton Park Island", shortName: "Oulton Park", imagePath: "Logos_and_icons/racetracks/Oulton_Park_Island.png" },
    { name: "Oulton Park Fosters", shortName: "Oulton Park", imagePath: "Logos_and_icons/racetracks/Oulton_Park_Fosters.png" },
    { name: "Oulton Park Classic", shortName: "Oulton Park", imagePath: "Logos_and_icons/racetracks/Oulton_Park_Classic.png" },
    { name: "Road America", shortName: "Road America", imagePath: "Logos_and_icons/racetracks/Road_America.png" },
    { name: "Road America (Bend)", shortName: "Road America", imagePath: "Logos_and_icons/racetracks/Road_America_Bend.png" },
    { name: "Road Atlanta", shortName: "Road Atlanta", imagePath: "Logos_and_icons/racetracks/Road_Atlanta.png" },
    { name: "Road Atlanta (Moto)", shortName: "Road Atlanta (M)", imagePath: "Logos_and_icons/racetracks/Road_AtlantaM.png" },
    { name: "Salvador Street Circuit", shortName: "Salvador Streets", imagePath: "Logos_and_icons/racetracks/Salvador_Street_Circuit.png" },
    { name: "Santa Cruz do Sul", shortName: "Santa Cruz", imagePath: "Logos_and_icons/racetracks/Santa_Cruz_do_Sul.png" },
    { name: "Sebring", shortName: "Sebring", imagePath: "Logos_and_icons/racetracks/Sebring.png" },
    { name: "Sebring School", shortName: "Sebring School", imagePath: "Logos_and_icons/racetracks/Sebring_School.png" },
    { name: "Sebring Club", shortName: "Sebring Club", imagePath: "Logos_and_icons/racetracks/Sebring_Club.png" },
    { name: "Silverstone", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone.png" },
    { name: "Silverstone International", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_International.png" },
    { name: "Silverstone National", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_National.png" },
    { name: "Silverstone 2001", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_Historic_2001.png" },
    { name: "Silverstone National 2001", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_National_Historic_2001.png" },
    { name: "Silverstone 1991", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_Historic_1991.png" },
    { name: "Silverstone 1975", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_Historic_1975.png" },
    { name: "Silverstone 1975 (no chicane)", shortName: "Silverstone", imagePath: "Logos_and_icons/racetracks/Silverstone_Historic_1975_no_chicane.png" },
    { name: "Snetterton 300", shortName: "Snetterton", imagePath: "Logos_and_icons/racetracks/Snetterton_300.png" },
    { name: "Snetterton 200", shortName: "Snetterton", imagePath: "Logos_and_icons/racetracks/Snetterton_200.png" },
    { name: "Spa-Francorchamps 2022", shortName: "Spa 2022", imagePath: "Logos_and_icons/racetracks/Spa-Francorchamps_2022.png" },
    { name: "Spa-Francorchamps 2020", shortName: "Spa 2022", imagePath: "Logos_and_icons/racetracks/Spa-Francorchamps_2020.png" },
    { name: "Spa-Francorchamps 1993", shortName: "Spa 1993", imagePath: "Logos_and_icons/racetracks/Spa-Francorchamps_Historic_1993.png" },
    { name: "Spa-Francorchamp 1970", shortName: "Spa 1970", imagePath: "Logos_and_icons/racetracks/Spa-FrancorchampsF11970.png" },
    { name: "Spa-Francorchamp 1970 1000Km", shortName: "Spa 1970", imagePath: "Logos_and_icons/racetracks/Spa-Francorchamps1970-78.png" },
    { name: "Spielberg", shortName: "Spielberg", imagePath: "Logos_and_icons/racetracks/Spielberg.png" },
    { name: "Spielberg Short", shortName: "Spielberg", imagePath: "Logos_and_icons/racetracks/Spielberg_Short.png" },
    { name: "Spielberg 1974", shortName: "Spielberg", imagePath: "Logos_and_icons/racetracks/Spielberg_1974.png" },
    { name: "Spielberg 1977", shortName: "Spielberg", imagePath: "Logos_and_icons/racetracks/Spielberg_1977.png" },
    { name: "Taruma Internacional", shortName: "Taruma", imagePath: "Logos_and_icons/racetracks/Taruma_Internacional.png" },
    { name: "Taruma Chicane", shortName: "Taruma", imagePath: "Logos_and_icons/racetracks/Taruma_Chicane.png" },
    { name: "Termas de Rio Hondo", shortName: "Rio Hondo", imagePath: "Logos_and_icons/racetracks/Termas_de_Rio_Hondo.png" },
    { name: "Velo Citta", shortName: "Velo Citta", imagePath: "Logos_and_icons/racetracks/Velo_Citta.png" },
    { name: "Velo Citta Track Day", shortName: "Velo Citta", imagePath: "Logos_and_icons/racetracks/Velo_Citta_Track_Day.png" },
    { name: "Velo Citta Club Day", shortName: "Velo Citta", imagePath: "Logos_and_icons/racetracks/Velo_Citta_Club_Day.png" },
    { name: "Velopark 2017", shortName: "Velopark", imagePath: "Logos_and_icons/racetracks/Velopark_2017.png" },
    { name: "Velopark 2010", shortName: "Velopark", imagePath: "Logos_and_icons/racetracks/Velopark_2010.png" },
    { name: "Virginia International Raceway Full", shortName: "Virginia Full", imagePath: "Logos_and_icons/racetracks/Virginia_International_Raceway_Full.png" },
    { name: "Virginia International Raceway Grand", shortName: "Virginia Grand", imagePath: "Logos_and_icons/racetracks/Virginia_International_Raceway_Grand.png" },
    { name: "Virginia International Raceway North", shortName: "Virginia North", imagePath: "Logos_and_icons/racetracks/Virginia_International_Raceway_North.png" },
    { name: "Virginia International Raceway South", shortName: "Virginia South", imagePath: "Logos_and_icons/racetracks/Virginia_International_Raceway_South.png" },
    { name: "Virginia International Raceway Patriot", shortName: "Virginia Patriot", imagePath: "Logos_and_icons/racetracks/virpatriot12.png" },
    { name: "Watkins Glen GP", shortName: "Watkins Glen", imagePath: "Logos_and_icons/racetracks/Watkins_Glen_GP.png" },
    { name: "Watkins Glen GP (Inner Loop)", shortName: "Watkins Glen", imagePath: "Logos_and_icons/racetracks/Watkins_Glen_GP_Inner_Loop.png" },
    { name: "Watkins Glen Short", shortName: "Watkins Glen", imagePath: "Logos_and_icons/racetracks/Watkins_Glen_Short.png" },
    { name: "Watkins Glen Short (Inner Loop)", shortName: "Watkins Glen", imagePath: "Logos_and_icons/racetracks/Watkins_Glen_Short_Inner_Loop.png" }
];


// This function creates the track list from the array of tracks, to populate the track selector menu
function populateTrackOptions() {
    let selectElement = document.getElementById('raceTrackSelect');

    if (!selectElement) {
        console.warn("populateTrackOptions: #raceTrackSelect not found on this page.");
        return;
    }

    // Clear existing options to make sure the track selector menu is empty before populating it
    selectElement.innerHTML = '';

    // Making the menu options
    trackData.forEach(track => {
        let option = document.createElement('option');
        option.value = track.name;
        option.textContent = track.name;
        selectElement.appendChild(option);
    });
}


function fetchCurrentData() {
    // Guard clause: only run if required elements are on the page
    const trackEl = document.getElementById('raceTrackSelect');
    const dateEl = document.getElementById('raceDate');
    const timeEl = document.getElementById('raceTime');
    const xoyondoEl = document.getElementById('xoyondoLink');

    if (!trackEl || !dateEl || !timeEl || !xoyondoEl) {
        console.warn("fetchCurrentData: Some required elements are missing on this page. Skipping fetch.");
        return;
    }

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
    var options = { weekday: 'short', month: 'short', day: 'numeric' };
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

    firebase.database().ref('race_location').set(resetValue).then(() => {
        document.getElementById('currentRaceTrack').textContent = resetValue;
    });
    firebase.database().ref('race_date').set(resetValue).then(() => {
        document.getElementById('currentRaceDate').textContent = resetValue;
    });
    firebase.database().ref('race_time').set(resetValue).then(() => {
        document.getElementById('currentRaceTime').textContent = resetValue;
    });
    firebase.database().ref('weather1').set(resetValue);
    firebase.database().ref('weather2').set(resetValue);
}

function setTrackTBD() {
    const tbdValue = "TBD";

    firebase.database().ref('race_location').set(tbdValue).then(() => {
        document.getElementById('currentRaceTrack').textContent = tbdValue;
    }).catch((error) => {
        console.error("Error setting race date to TBD: ", error);
    });
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

// Create trackmapping for short names
window.trackMap = {};
trackData.forEach(track => {
  window.trackMap[track.name] = {
    short: track.shortName,
    full: track.name
  };
});

