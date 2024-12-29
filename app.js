var nano = require('nanochoo')
var x = require('hyperaxe')
var app = nano()

// Initialize Socket.io client connection
const socket = io.connect()

app.view(view)
app.use(store)
app.mount('#app')

function view(state, emit) {
    var gamepads = Object.values(state.controllers)
    var title = x('p.title')

    return x('#app')(
        gamepads.length < 1
            ? 'Press a button on any connected controller to get started. All connected gamepads will be detected.'
            : gamepads.map((gamepad, idx) =>
                  x('.gamepad')(
                      title(`${idx + 1}: ${gamepad.id}`),
                      title('Buttons'),
                      x('.buttons')(buttons(gamepad.index, gamepad.buttons)),
                      title('Axes'),
                      x('.axes')(axes(gamepad.index, gamepad.axes))
                  )
              )
    )
}

function buttons(index, arr) {
    return arr.map((button, idx) => {
        var pressed = button === 1.0
        var touched = button === 1.0
        var val = button

        if (typeof button === 'object') {
            pressed = button.pressed
            touched = button.touched
            val = button.value
        }

        var pct = `${Math.round(val * 100)}%`

        return x(`.button${pressed ? '.pressed' : ''}`)(
            { style: `background-size: ${pct} ${pct}` },
            idx
        )
    })
}

function axes(index, arr) {
    return arr.map((axis, idx) => {
        var pressed = axis < -0.15 || axis > 0.15 ? '.pressed' : ''
        var pressedBool = axis < -0.15 || axis > 0.15 ? true : false

        return x('.axis')(
            x(`span.button${pressed}`)(idx),
            x(`meter${pressed}`)(
                { min: -1, max: 1, value: axis },
                `${idx}: ${axis.toFixed(4)}`
            )
        )
    })
}

function store(state, emitter) {
    state.controllers = {}
    state.requestId = null

    // Join the 'controllers_web' room upon connecting
    socket.on('connect', () => {
        emitter.emit('render')
        socket.emit('join_controllers_web')
    })

    socket.on('gamepad_connected', (data) => {
        console.log('Gamepad connected:', data)
        state.controllers[data.index] = data
        emitter.emit('render')
    })

    socket.on('gamepad_disconnected', (data) => {
        console.log('Gamepad disconnected:', data)
        delete state.controllers[data.index]
        emitter.emit('render')
    })

    socket.on('gamepad_data', (data) => {
        state.controllers[data.index] = data
        emitter.emit('render')
    })
}
