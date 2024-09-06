# gamepad-io

> Use gamepads in other ways by exposing events via socket.io. Primarily designed to work with Bitfocus Companion to enable gamepads to be surface controllers.

The software works by opening a hidden window that detects gamepads using the Web GamePad API. These events are sent from the renderer process to the main process, and then emitted to any clients.

See the [API](./api.md) for use.

## Install

*macOS 10.10+, Linux, and Windows 7+ are supported (64-bit only).*

**macOS**

[**Download**](https://github.com/josephdadams/gamepad-io/releases/latest) the `.dmg` file.

**Linux**

[**Download**](https://github.com/josephdadams/gamepad-io/releases/latest) the `.AppImage` or `.deb` file.

*The AppImage needs to be [made executable](http://discourse.appimage.org/t/how-to-make-an-appimage-executable/80) after download.*

**Windows**

[**Download**](https://github.com/josephdadams/gamepad-io/releases/latest) the `.exe` file.

---

## Dev

Built with [Electron](https://electronjs.org).

### Run

```
$ yarn
$ yarn start
```