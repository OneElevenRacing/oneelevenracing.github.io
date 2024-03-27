// Initialize Firebase as shown in previous examples

// Sign-in function
document.getElementById('signin-button').addEventListener('click', function() {
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).then(function(result) {
        // Successful sign-in
        window.location.href = 'main.html'; // Redirect to main page
    }).catch(function(error) {
        // Handle sign-in errors
        console.log('Sign-in error:', error);
    });
});

function logoutUser() {
    firebase.auth().signOut().then(function() {
        // Sign-out successful, redirect to login page
        window.location.href = 'index.html';
    }).catch(function(error) {
        // An error happened during logout, handle it here
        console.error("Error during logout: ", error);
    });
}
