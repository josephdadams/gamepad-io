'use strict';

const { app, Notification, nativeImage, systemPreferences, Menu, shell, Tray } = require('electron');
const config = require('./config.js');
const package_json = require('./package.json');
const util = require('./util.js');

const VERSION = package_json.version;

global.tray = undefined;

global.win = undefined;

global.DEVICES = [];

// Note: Must match `build.appId` in package.json
app.setAppUserModelId(config.get('appUserModelId'));
if (process.platform == 'darwin') {
	app.dock.hide();
}

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
	app.quit();
}

app.on('second-instance', () => {

});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', async () => {

});

(async () => {
	await app.whenReady();

	const icon = nativeImage.createFromDataURL(config.get('icon'));
	global.tray = new Tray(icon.resize({ width: 24, height: 24 }));
	global.tray.setToolTip('gamepad-io');

	//util call here
	util.startUp();
})();