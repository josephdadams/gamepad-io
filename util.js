const {
    app,
    Notification,
    nativeImage,
    systemPreferences,
    Menu,
    shell,
    ipcMain,
    BrowserWindow,
} = require('electron')

const config = require('./config.js')

const package_json = require('./package.json')
const VERSION = package_json.version
const path = require('path')

const express = require('express')
const http = require('http')
const socketio = require('socket.io')
const short = require('short-uuid')

var server = null
var httpServer = null
var io = null

function setUp() {
    console.log('Beginning gamepad-io setup...')

    global.CONTROLLERS = []

    startSocketIO()
    createWindow()
    loadIPCEvents()
    buildContextMenu()
}

function startSocketIO() {
    //starts the REST API
    server = express()
    httpServer = new http.Server(server)
    io = new socketio.Server(httpServer, { allowEIO3: true })
    port = config.get('apiPort')

    server.use(express.json()) //parse json in body
    server.use(express.static(path.join(__dirname, 'static')))

    server.get('/', function (req, res) {
        res.sendFile('controllers.html', { root: __dirname })
    })

    server.use(function (req, res) {
        res.status(404).send({
            error: true,
            url: req.originalUrl + ' not found.',
        })
    })

    io.sockets.on('connection', (socket) => {
        socket.on('version', function () {
            socket.emit('version', VERSION)
        })

        socket.on('controllers', function () {
            socket.emit('controllers', global.CONTROLLERS)
        })

        socket.on('join_room', function (uuid) {
            socket.join(uuid)
            markInUse(uuid, true)
        })

        socket.on('leave_room', function (uuid) {
            socket.join(uuid)
            markInUse(uuid, false)
        })

        socket.on('haptic', function (uuid, type, params) {
            let controller = getControllerByUUID(uuid)
            if (controller !== null) {
                global.win.webContents.send(
                    'haptic',
                    controller.index,
                    type,
                    params
                )
            }
        })
    })

    try {
        httpServer.listen(port)
        console.log('REST/Socket.io API server started on: ' + port)
    } catch (error) {
        if (error.toString().indexOf('EADDRINUSE') > -1) {
            showNotification({
                title: 'Error',
                body: 'Unable to start server. Is gamepad-io already running?',
                showNotification: true,
            })
        }
    }
}

function createWindow() {
    //the window is what grabs the gamepad events, but we don't need to show it, it can just be in the background

    global.win = new BrowserWindow({
        width: 1000,
        height: 600,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
        },
        icon: config.get('icon'),
    })

    global.win.loadFile('index.html')

    global.win.once('ready-to-show', () => {
        showWindow()
    })

    global.win.webContents.on('did-finish-load', () => {
        //global.win.show();
        if (global.CONTROLLERS.length < 1) {
            //show notification that they need to first press a button on a gamepad
            showNotification({
                title: 'No gamepads found.',
                body: 'Please press a button on a gamepad to detect gamepads.',
                showNotification: true,
            })
        }

        //show dev tools
        //global.win.webContents.openDevTools();
    })

    global.win.on('close', (event) => {
        event.preventDefault()
        global.win.hide()
    })

    app.on('before-quit', function (evt) {
        //close the window
        global.win.destroy()
        global.tray.destroy()
    })
}

function loadIPCEvents() {
    ipcMain.on(
        'gamepad_connected',
        (event, index, id, totalButtons, totalAxes) => {
            showNotification({
                title: 'Gamepad Connected',
                body: id,
                showNotification: true,
            })

            //first check the internal store to see if this gamepad has connected before by comparing the id field. If it has, attach the uuid to the object
            //if that uuid is already in use, keep checking to see if there is another one in the store that is not in use
            //if there is not one, generate a new uuid
            let uuid = null

            let storeControllers = config.get('controllers')

            for (let i = 0; i < storeControllers.length; i++) {
                if (storeControllers[i].id == id) {
                    //now check to see if this uuid is already in use by a currently connected gamepad since gamepads are not necessarily presented with unique names i.e. two identical controller types
                    let uuidInUse = false
                    for (let j = 0; j < global.CONTROLLERS.length; j++) {
                        if (
                            global.CONTROLLERS[j].uuid ==
                            storeControllers[i].uuid
                        ) {
                            uuidInUse = true
                            break
                        }
                    }

                    if (!uuidInUse) {
                        uuid = storeControllers[i].uuid
                        break
                    }
                }
            }

            if (uuid == null) {
                uuid = short.generate()

                storeControllers.push({
                    id: id,
                    uuid: uuid,
                })
                config.set('controllers', storeControllers)
            }

            //buuild the buttons and axes arrays
            let buttons = []
            let axes = []

            for (let i = 0; i < totalButtons; i++) {
                buttons.push({
                    buttonIndex: i,
                    pressed: false,
                    touched: false,
                    value: 0,
                    percent: 0,
                })
            }

            for (let i = 0; i < totalAxes; i++) {
                axes.push({
                    axisIndex: i,
                    pressed: false,
                    value: 0,
                })
            }

            //now add to global.CONTROLLERS
            let gamepadObj = {
                index: index, //index of the gamepad based on when it was connected to the computer
                id: id, //id of the gamepad - a name and product/vendor id
                uuid: uuid, //a unique identifier for this gamepad
                buttons: buttons, //array of button events
                axes: axes, //array of axis events
            }

            global.CONTROLLERS.push(gamepadObj)

            //rebuild context menu
            buildContextMenu()

            //send updated controllers to clients
            sendControllers()
        }
    )

    ipcMain.on('gamepad_disconnected', (event, index) => {
        let controller = getControllerByIndex(index)
        showNotification({
            title: 'Gamepad Disconnected',
            body: controller.id,
            showNotification: true,
        })

        //remove from global.CONTROLLERS
        global.CONTROLLERS = global.CONTROLLERS.filter((device) => {
            return device.index != index
        })

        //rebuild context menu
        buildContextMenu()

        //send updated controllers to clients
        sendControllers()
    })

    ipcMain.on(
        'button_event',
        (event, index, buttonIndex, pressed, touched, val, pct) => {
            //first determine if this button data is different than what is currently stored
            //if it is the same, do not add to global.CONTROLLERS
            let buttonExists = false
            let buttonChanged = false

            for (let i = 0; i < global.CONTROLLERS.length; i++) {
                if (global.CONTROLLERS[i].index == index) {
                    for (
                        let j = 0;
                        j < global.CONTROLLERS[i].buttons.length;
                        j++
                    ) {
                        if (
                            global.CONTROLLERS[i].buttons[j].buttonIndex ==
                            buttonIndex
                        ) {
                            buttonExists = true
                            //now check if any of the other fields are different, so we know whether to send this button data to the clients
                            if (
                                global.CONTROLLERS[i].buttons[j].pressed ==
                                    pressed &&
                                global.CONTROLLERS[i].buttons[j].touched ==
                                    touched &&
                                global.CONTROLLERS[i].buttons[j].value == val &&
                                global.CONTROLLERS[i].buttons[j].percent == pct
                            ) {
                                buttonChanged = false
                            } else {
                                buttonChanged = true
                                //update in place
                                global.CONTROLLERS[i].buttons[j].pressed =
                                    pressed
                                global.CONTROLLERS[i].buttons[j].touched =
                                    touched
                                global.CONTROLLERS[i].buttons[j].value = val
                                global.CONTROLLERS[i].buttons[j].percent = pct
                            }
                        }
                    }
                }
            }

            if (!buttonExists) {
                //add button event to global.CONTROLLERS
                global.CONTROLLERS.forEach((device) => {
                    if (device.index == index) {
                        device.buttons.push({
                            buttonIndex: buttonIndex,
                            pressed: pressed,
                            value: val,
                            percent: pct,
                        })
                    }
                })
            }

            if (buttonChanged) {
                let controller = getControllerByIndex(index)
                let uuid = ''

                if (controller !== null) {
                    uuid = controller.uuid
                }

                sendButtonEvent(uuid, buttonIndex, pressed, touched, val, pct)
            }
        }
    )

    ipcMain.on('axis_event', (event, index, idx, pressedBool, axis) => {
        //first determine if this axis data is different than what is currently stored
        //if it is the same, do not add to global.CONTROLLERS
        let axisExists = false
        let axisChanged = false

        for (let i = 0; i < global.CONTROLLERS.length; i++) {
            if (global.CONTROLLERS[i].index == index) {
                for (let j = 0; j < global.CONTROLLERS[i].axes.length; j++) {
                    if (global.CONTROLLERS[i].axes[j].axisIndex == idx) {
                        axisExists = true
                        //now check if any of the other fields are different, so we know whether to send this axis data to the clients
                        if (
                            global.CONTROLLERS[i].axes[j].pressed ==
                                pressedBool &&
                            global.CONTROLLERS[i].axes[j].value == axis
                        ) {
                            axisChanged = false
                        } else {
                            axisChanged = true
                            //update in place
                            global.CONTROLLERS[i].axes[j].pressed = pressedBool
                            global.CONTROLLERS[i].axes[j].value = axis
                        }
                    }
                }
            }
        }

        if (!axisExists) {
            //add axis event to global.CONTROLLERS
            global.CONTROLLERS.forEach((device) => {
                if (device.index == index) {
                    device.axes.push({
                        axisIndex: idx,
                        pressed: pressedBool,
                        value: axis,
                    })
                }
            })
        }

        if (axisChanged) {
            let controller = getControllerByIndex(index)
            let uuid = ''

            if (controller !== null) {
                uuid = controller.uuid
            }

            sendAxisEvent(uuid, idx, pressedBool, axis)
        }
    })
}

function sendControllers() {
    io.sockets.emit('controllers', global.CONTROLLERS)
}

function sendButtonEvent(uuid, buttonIndex, pressed, touched, val, pct) {
    //only emit to this controller's room (by uuid)
    io.to(uuid).emit(
        'button_event',
        uuid,
        buttonIndex,
        pressed,
        touched,
        val,
        pct
    )
    //io.sockets.emit('button_event', uuid, buttonIndex, pressed, touched, val, pct);
}

function sendAxisEvent(uuid, idx, pressedBool, axis) {
    //only emit to this controller's room (by uuid)
    io.to(uuid).emit('axis_event', uuid, idx, pressedBool, axis)
    //io.sockets.emit('axis_event', uuid, idx, pressedBool, axis);
}

function getControllerByIndex(idx) {
    let controller = null
    global.CONTROLLERS.forEach((device) => {
        if (device.index == idx) {
            controller = device
        }
    })

    return controller
}

function getControllerByUUID(uuid) {
    let controller = null
    global.CONTROLLERS.forEach((device) => {
        if (device.uuid == uuid) {
            controller = device
        }
    })

    return controller
}

function markInUse(uuid, inUse) {
    global.CONTROLLERS.forEach((device) => {
        if (device.uuid == uuid) {
            device.inUse = inUse
        }
    })

    sendControllers()
}

function buildContextMenu() {
    let menuArr = []

    menuArr.push({
        label: 'gamepad-io: v' + VERSION,
        enabled: false,
    })

    menuArr.push({
        type: 'separator',
    })

    menuArr.push({
        label: 'Controllers Detected: ' + global.CONTROLLERS.length,
        enabled: false,
    })

    for (let i = 0; i < global.CONTROLLERS.length; i++) {
        menuArr.push({
            label: global.CONTROLLERS[i].id,
            enabled: false,
        })
    }

    let verb = global.win.isVisible() ? 'Hide' : 'Show'

    menuArr.push({
        label: `${verb} Controls`,
        type: 'normal',
        click: function () {
            showWindow()
        },
    })

    menuArr.push({
        type: 'separator',
    })

    menuArr.push({
        label: 'Show Notifications',
        type: 'checkbox',
        checked: config.get('allowNotifications'),
        click: function () {
            config.set('allowNotifications', !config.get('allowNotifications'))
        },
    })

    menuArr.push({
        type: 'separator',
    })

    menuArr.push({
        label: 'Request Help/Support',
        click: function () {
            shell.openExternal(config.get('supportUrl'))
        },
    })

    menuArr.push({
        label: 'Quit',
        click: function () {
            global.win.close()
            app.quit()
        },
    })

    let contextMenu = Menu.buildFromTemplate(menuArr)

    global.tray.setContextMenu(contextMenu)
}

function showWindow() {
    if (global.win.isVisible()) {
        global.win.hide()
    } else {
        global.win.show()
    }

    buildContextMenu()
}

function showNotification(notificationObj) {
    const icon = nativeImage.createFromDataURL(config.get('icon'))

    if (config.get('allowNotifications')) {
        if (notificationObj.showNotification == true) {
            let NOTIFICATION_TITLE =
                notificationObj.title || 'gamepad-io Notification'
            let NOTIFICATION_BODY = notificationObj.body || ''
            new Notification({
                title: NOTIFICATION_TITLE,
                subtitle: NOTIFICATION_BODY,
                icon: icon,
                silent: true,
            }).show()
        }
    }
}

module.exports = {
    startUp() {
        setUp()
    },

    showNotification(notificationObj) {
        showNotification(notificationObj)
    },
}
