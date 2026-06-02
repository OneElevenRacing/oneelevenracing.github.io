// Sign-in function
document.addEventListener('DOMContentLoaded', function() {
    var signInButton = document.getElementById('signin-button');
    if (!signInButton) return;

    signInButton.addEventListener('click', function() {
        var provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).then(function() {
            window.location.href = 'main.html';
        }).catch(function(error) {
            console.log('Sign-in error:', error);
            alert('Sign-in failed. Please try again.');
        });
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
