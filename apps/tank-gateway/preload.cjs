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
	openDisplay: () => ipcRenderer.invoke('display:open'),
	closeDisplay: () => ipcRenderer.invoke('display:close'),
	acknowledgeAlarms: () => ipcRenderer.invoke('alarm:acknowledge'),
	playTestSound: () => ipcRenderer.send('display:test-sound'),
	onTestSound: (handler) => {
		const listener = () => handler()
		ipcRenderer.on('display:test-sound', listener)
		return () => ipcRenderer.removeListener('display:test-sound', listener)
	},
	onState: (handler) => {
		const listener = (_event, state) => handler(state)
		ipcRenderer.on('gateway:state', listener)
		return () => ipcRenderer.removeListener('gateway:state', listener)
	}
})
