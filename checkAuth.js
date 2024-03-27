firebase.auth().onAuthStateChanged(function(user) {
    if (!user) {
        // User is not signed in, redirect to login page
        window.location.href = 'index.html';
    }
    // User is signed in, proceed with loading the page content
});
