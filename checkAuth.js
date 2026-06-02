(function() {
    function getDriver(uid) {
        return firebase.database().ref('drivers/' + uid).once('value')
            .then(function(snapshot) {
                return snapshot.val();
            });
    }

    function redirectTo(url) {
        window.location.href = url || 'index.html';
    }

    function showBodyIfHidden() {
        if (document.body && document.body.style.display === 'none') {
            document.body.style.display = '';
        }
    }

    function requireActiveDriver(options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            firebase.auth().onAuthStateChanged(function(user) {
                if (!user) {
                    redirectTo(options.loginUrl || 'index.html');
                    reject(new Error('User is not signed in.'));
                    return;
                }

                getDriver(user.uid).then(function(driver) {
                    if (!driver || driver.active !== true) {
                        if (options.showMessage) {
                            document.body.innerHTML = '<h2>Access denied.</h2>';
                            showBodyIfHidden();
                        } else {
                            redirectTo(options.deniedUrl || 'index.html');
                        }
                        reject(new Error('User is not an active driver.'));
                        return;
                    }

                    if (options.showBody) showBodyIfHidden();
                    document.dispatchEvent(new CustomEvent('oneEleven:activeDriver', {
                        detail: { user: user, driver: driver }
                    }));
                    resolve({ user: user, driver: driver });
                }).catch(function(error) {
                    console.error('Error checking driver access:', error);
                    if (options.showMessage) {
                        document.body.innerHTML = '<h2>Error verifying access. Please try again later.</h2>';
                        showBodyIfHidden();
                    } else {
                        redirectTo(options.deniedUrl || 'index.html');
                    }
                    reject(error);
                });
            });
        });
    }

    function requireAdmin(options) {
        options = options || {};

        return requireActiveDriver({
            loginUrl: options.loginUrl,
            deniedUrl: options.deniedUrl,
            showMessage: options.showMessage
        }).then(function(result) {
            if (result.driver.isAdmin !== true) {
                if (options.showMessage) {
                    document.body.innerHTML = '<h2>You must be an admin to view this page.</h2>';
                    showBodyIfHidden();
                } else {
                    redirectTo(options.deniedUrl || 'settings.html');
                }
                throw new Error('User is not an admin.');
            }

            if (options.showBody) showBodyIfHidden();
            document.dispatchEvent(new CustomEvent('oneEleven:adminDriver', {
                detail: result
            }));
            return result;
        });
    }

    window.oneElevenAuth = {
        getDriver: getDriver,
        requireActiveDriver: requireActiveDriver,
        requireAdmin: requireAdmin
    };

    document.addEventListener('DOMContentLoaded', function() {
        if (!document.body || document.body.dataset.skipAuthCheck === 'true') return;

        if (document.body.dataset.requireAdmin === 'true') {
            requireAdmin({
                deniedUrl: document.body.dataset.deniedUrl || 'settings.html',
                showBody: true,
                showMessage: true
            }).catch(function() {});
            return;
        }

        requireActiveDriver({
            deniedUrl: document.body.dataset.deniedUrl || 'index.html',
            showBody: document.body.dataset.showAfterAuth === 'true'
        }).catch(function() {});
    });
})();
