'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tankGateway', {
	getInitialState: () => ipcRenderer.invoke('app:getInitialState'),
	saveConfig: (config) => ipcRenderer.invoke('config:save', config),
	clearCredential: () => ipcRenderer.invoke('credential:clear'),
	login: (payload) => ipcRenderer.invoke('gateway:login', payload),
	probe: (config) => ipcRenderer.invoke('gateway:probe', config),
	start: (config) => ipcRenderer.invoke('gateway:start', config),
	stop: () => ipcRenderer.invoke('gateway:stop'),
	onState: (handler) => {
		const listener = (_event, state) => handler(state)
		ipcRenderer.on('gateway:state', listener)
		return () => ipcRenderer.removeListener('gateway:state', listener)
	}
})
