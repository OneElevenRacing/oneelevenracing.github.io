// Sign-in page
document.addEventListener('DOMContentLoaded', function() {
    var signInButton = document.getElementById('signin-button');
    if (!signInButton) return;

    var message = document.getElementById('signin-message');
    var reason = new URLSearchParams(window.location.search).get('reason');

    if (reason === 'inactive') {
        // Sign the account out so a different Google account can be chosen.
        firebase.auth().signOut();
        if (message) message.textContent = 'This Google account is not an active One Eleven driver. Ask an admin to add you, or sign in with a different account.';
    } else if (reason === 'error') {
        if (message) message.textContent = 'We could not check your access. Please check your connection and try again.';
    } else {
        // Already signed in: go straight to the app.
        var unsubscribe = firebase.auth().onAuthStateChanged(function(user) {
            unsubscribe();
            if (user) window.location.href = 'main.html';
        });
    }

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
