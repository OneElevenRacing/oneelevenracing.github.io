// Initialize Firebase as shown in previous examples

// Function to check if the user is in a webview
function isInWebview() {
    // Check if the user agent contains keywords indicating a webview
    var userAgent = navigator.userAgent.toLowerCase();
    return userAgent.includes('wv') || userAgent.includes('webview');
}

// Sign-in function
document.getElementById('signin-button').addEventListener('click', function() {
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).then(function(result) {
        // Successful sign-in
        if (isInWebview()) {
            // Open the main page in a new browser window
            window.open('main.html', '_blank');
        } else {
            // Redirect to main page
            window.location.href = 'main.html';
        }
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
