class EJS_Netplay {
    constructor(socket, guid, iceServers = []) {
        this.socket = socket;
        this.guid = guid;
        this.iceServers = iceServers;
        this.peers = new Map();
        this.onData = null;

        this.socket.on('signal', ({ guid: remote, data }) => {
            if (!remote || remote === this.guid) return;
            this._handleSignal(remote, data);
        });
    }

    createPeer(remoteGuid, initiator) {
        if (remoteGuid === this.guid || this.peers.has(remoteGuid)) return;
        const peer = new window.SimplePeer({
            initiator,
            trickle: false,
            config: { iceServers: this.iceServers }
        });

        peer.on('signal', data => {
            this.socket.emit('signal', { data });
        });

        peer.on('data', chunk => {
            let msg;
            try {
                msg = JSON.parse(chunk.toString());
            } catch {
                return;
            }
            this.onData && this.onData(msg, remoteGuid);
        });

        peer.on('close', () => {
            this.peers.delete(remoteGuid);
        });

        this.peers.set(remoteGuid, peer);
        return peer;
    }

    _handleSignal(remoteGuid, data) {
        let peer = this.peers.get(remoteGuid);
        if (!peer) {
            peer = this.createPeer(remoteGuid, false);
        }
        peer.signal(data);
    }

    broadcast(message) {
        const str = JSON.stringify(message);
        for (const peer of this.peers.values()) {
            if (peer.connected) {
                peer.send(str);
            }
        }
    }
}

window.EJS_Netplay = EJS_Netplay;

class EJS_NetplayManager {
    constructor(emulator) {
        this.emulator = emulator;
        this.url = emulator.config.netplayUrl;
        while (this.url.endsWith('/')) {
            this.url = this.url.substring(0, this.url.length - 1);
        }
        this.name = emulator.config.netplayName || '';
        this.playerID = emulator.config.netplayGuid || this._guidGenerator();
        this.token = emulator.config.netplayToken;
        this.spectator = !!emulator.config.netplaySpectator;
        this.currentFrame = 0;
        this.init_frame = 0;
        this.inputsData = {};
        this.updateList = {
            start: () => {
                this.updateList.interval = setInterval(this.updateTableList.bind(this.emulator), 1000);
            },
            stop: () => {
                clearInterval(this.updateList.interval);
            }
        };
    }

    _guidGenerator() {
        const S4 = function () {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        };
        return (S4() + S4() + '-' + S4() + '-' + S4() + '-' + S4() + '-' + S4() + S4() + S4());
    }

    startSocketIO(callback) {
        const opts = {};
        if (this.token) opts.auth = { token: this.token };
        this.socket = io(this.url, opts);
        this.webrtc = new window.EJS_Netplay(this.socket, this.playerID, this.emulator.config.netplayIceServers || []);
        this.webrtc.onData = this.dataMessage.bind(this);
        this.socket.on('connect', () => callback());
        this.socket.on('joined', (info) => {
            this.players[info.guid] = info;
            this.updatePlayersTable();
        });
        this.socket.on('user-joined', (info) => {
            this.players[info.guid] = info;
            this.updatePlayersTable();
            if (this.webrtc && info.guid !== this.playerID) {
                const initiator = this.playerID < info.guid;
                this.webrtc.createPeer(info.guid, initiator);
            }
        });
        this.socket.on('user-left', (info) => {
            delete this.players[info.guid];
            if (this.webrtc && this.webrtc.peers.has(info.guid)) {
                const p = this.webrtc.peers.get(info.guid);
                if (p.destroy) p.destroy();
                this.webrtc.peers.delete(info.guid);
            }
            this.updatePlayersTable();
        });
        this.socket.on('disconnect', () => this.roomLeft());
    }

    openRoom(roomName, maxPlayers, password) {
        const sessionid = this._guidGenerator();
        this.playerID = this._guidGenerator();
        this.players = {};
        this.extra = {
            domain: window.location.host,
            game_id: this.emulator.config.gameId,
            room_name: roomName,
            player_name: this.name,
            userid: this.playerID,
            sessionid: sessionid
        };
        this.users = {};

        this.startSocketIO(() => {
            this.socket.emit('create-room', {
                roomId: sessionid,
                roomName: roomName,
                maxPlayers: maxPlayers,
                maxViewers: 10,
                password: password,
                name: this.name,
                guid: this.playerID
            }, (error) => {
                if (error) {
                    if (this.emulator.debug) console.log('error: ', error);
                    return;
                }
                this.roomJoined(true, roomName, password, sessionid);
            });
        });
    }

    leaveRoom() {
        if (this.emulator.debug) console.log('asd');
        this.roomLeft();
    }

    joinRoom(sessionid, roomName) {
        this.playerID = this._guidGenerator();
        this.players = {};
        this.extra = {
            domain: window.location.host,
            game_id: this.emulator.config.gameId,
            room_name: roomName,
            player_name: this.name,
            userid: this.playerID,
            sessionid: sessionid
        };

        this.startSocketIO(() => {
            this.socket.emit('join-room', {
                roomId: sessionid,
                name: this.name,
                guid: this.playerID,
                spectator: this.spectator
            }, (error) => {
                if (error) {
                    if (this.emulator.debug) console.log('error: ', error);
                    return;
                }
                this.roomJoined(false, roomName, '', sessionid);
            });
        });
    }

    roomJoined(isOwner, roomName, password, roomId) {
        this.emulator.isNetplay = true;
        this.inputs = {};
        this.owner = isOwner;
        if (this.emulator.debug) console.log(this.extra);
        this.roomNameElem.innerText = roomName;
        this.tabs[0].style.display = 'none';
        this.tabs[1].style.display = '';
        if (password) {
            this.passwordElem.style.display = '';
            this.passwordElem.innerText = this.emulator.localization('Password') + ': ' + password;
        } else {
            this.passwordElem.style.display = 'none';
        }
        this.createButton.innerText = this.emulator.localization('Leave Room');
        this.updatePlayersTable();
        if (!this.owner) {
            this.oldStyles = [
                this.emulator.elements.bottomBar.cheat[0].style.display,
                this.emulator.elements.bottomBar.playPause[0].style.display,
                this.emulator.elements.bottomBar.playPause[1].style.display,
                this.emulator.elements.bottomBar.restart[0].style.display,
                this.emulator.elements.bottomBar.loadState[0].style.display,
                this.emulator.elements.bottomBar.saveState[0].style.display,
                this.emulator.elements.bottomBar.saveSavFiles[0].style.display,
                this.emulator.elements.bottomBar.loadSavFiles[0].style.display,
                this.emulator.elements.contextMenu.save.style.display,
                this.emulator.elements.contextMenu.load.style.display
            ];
            this.emulator.elements.bottomBar.cheat[0].style.display = 'none';
            this.emulator.elements.bottomBar.playPause[0].style.display = 'none';
            this.emulator.elements.bottomBar.playPause[1].style.display = 'none';
            this.emulator.elements.bottomBar.restart[0].style.display = 'none';
            this.emulator.elements.bottomBar.loadState[0].style.display = 'none';
            this.emulator.elements.bottomBar.saveState[0].style.display = 'none';
            this.emulator.elements.bottomBar.saveSavFiles[0].style.display = 'none';
            this.emulator.elements.bottomBar.loadSavFiles[0].style.display = 'none';
            this.emulator.elements.contextMenu.save.style.display = 'none';
            this.emulator.elements.contextMenu.load.style.display = 'none';
            this.emulator.gameManager.resetCheat();
        } else {
            this.oldStyles = [
                this.emulator.elements.bottomBar.cheat[0].style.display
            ];
        }
        this.emulator.elements.bottomBar.cheat[0].style.display = 'none';
    }

    updatePlayersTable() {
        const table = this.playerTable;
        table.innerHTML = '';
        const addRow = (num, playerName) => {
            const row = this.emulator.createElement('tr');
            const addCell = (text) => {
                const item = this.emulator.createElement('td');
                item.innerText = text;
                row.appendChild(item);
                return item;
            };
            addCell(num).style.width = '80px';
            addCell(playerName);
            addCell('').style.width = '80px';
            table.appendChild(row);
        };
        for (const id in this.players) {
            const info = this.players[id];
            const name = info.name || info.player_name || id;
            if (info.spectator || info.player == null) {
                addRow(this.emulator.localization('Viewer'), name);
            } else {
                addRow(this.emulator.localization('Player') + ' ' + info.player, name);
            }
        }
    }

    roomLeft() {
        this.emulator.isNetplay = false;
        this.tabs[0].style.display = '';
        this.tabs[1].style.display = 'none';
        this.extra = null;
        this.playerID = null;
        this.spectator = !!this.emulator.config.netplaySpectator;
        this.createButton.innerText = this.emulator.localization('Create a Room');
        this.socket.disconnect();
        this.emulator.elements.bottomBar.cheat[0].style.display = this.oldStyles[0];
        if (!this.owner) {
            this.emulator.elements.bottomBar.playPause[0].style.display = this.oldStyles[1];
            this.emulator.elements.bottomBar.playPause[1].style.display = this.oldStyles[2];
            this.emulator.elements.bottomBar.restart[0].style.display = this.oldStyles[3];
            this.emulator.elements.bottomBar.loadState[0].style.display = this.oldStyles[4];
            this.emulator.elements.bottomBar.saveState[0].style.display = this.oldStyles[5];
            this.emulator.elements.bottomBar.saveSavFiles[0].style.display = this.oldStyles[6];
            this.emulator.elements.bottomBar.loadSavFiles[0].style.display = this.oldStyles[7];
            this.emulator.elements.contextMenu.save.style.display = this.oldStyles[8];
            this.emulator.elements.contextMenu.load.style.display = this.oldStyles[9];
        }
        this.emulator.updateCheatUI();
    }

    setLoading(loading) {
        if (this.emulator.debug) console.log('loading:', loading);
    }

    async sync() {
        if (this.syncing) return;
        this.syncing = true;
        if (this.emulator.debug) console.log('sync');
        this.ready = 0;
        const state = this.emulator.gameManager.getState();
        this.sendMessage({ state: state });
        this.setLoading(true);
        this.emulator.pause(true);
        this.ready++;
        this.current_frame = 0;
        if (this.ready === this.getUserCount()) {
            this.emulator.play(true);
        }
        this.syncing = false;
    }

    getUserIndex(user) {
        let i = 0;
        for (const k in this.players) {
            if (k === user) return i;
            i++;
        }
        return -1;
    }

    getUserCount() {
        let i = 0;
        for (const k in this.players) i++;
        return i;
    }

    dataMessage(data) {
        if (data.sync === true && this.owner) {
            this.sync();
        }
        if (data.state) {
            this.wait = true;
            this.setLoading(true);
            this.emulator.pause(true);
            this.emulator.gameManager.loadState(new Uint8Array(data.state));
            this.sendMessage({ ready: true });
        }
        if (data.play && !this.owner) {
            this.emulator.play(true);
        }
        if (data.pause && !this.owner) {
            this.emulator.pause(true);
        }
        if (data.ready && this.owner) {
            this.ready++;
            if (this.ready === this.getUserCount()) {
                this.sendMessage({ readyready: true });
                this.reset();
                setTimeout(() => this.emulator.play(true), 48);
                this.setLoading(false);
            }
        }
        if (data.readyready) {
            this.setLoading(false);
            this.reset();
            this.emulator.play(true);
        }
        if (data.shortPause && data.shortPause !== this.playerID) {
            this.emulator.pause(true);
            this.wait = true;
            setTimeout(() => this.emulator.play(true), 48);
        }
        if (data['sync-control']) {
            data['sync-control'].forEach((value) => {
                let inFrame = parseInt(value.frame);
                let frame = this.currentFrame;
                if (!value.connected_input || value.connected_input[0] < 0) return;
                if (inFrame === frame) {
                    inFrame++;
                    this.emulator.gameManager.functions.simulateInput(value.connected_input[0], value.connected_input[1], value.connected_input[2]);
                }
                this.inputsData[inFrame] || (this.inputsData[inFrame] = []);
                this.inputsData[frame] || (this.inputsData[frame] = []);
                if (this.owner) {
                    this.inputsData[frame].push(value);
                    this.emulator.gameManager.functions.simulateInput(value.connected_input[0], value.connected_input[1], value.connected_input[2]);
                    if (frame - 10 >= inFrame) {
                        this.wait = true;
                        this.emulator.pause(true);
                        setTimeout(() => {
                            this.emulator.play(true);
                            this.wait = false;
                        }, 48);
                    }
                } else {
                    this.inputsData[inFrame].push(value);
                    if (this.inputsData[frame]) {
                        this.emulator.play(true);
                    }
                    if (frame + 10 <= inFrame && inFrame > this.init_frame + 100) {
                        this.sendMessage({ shortPause: this.playerID });
                    }
                }
            });
        }
        if (data.restart) {
            this.emulator.gameManager.restart();
            this.reset();
            this.emulator.play(true);
        }
    }

    simulateInput(player, index, value, resp) {
        if (!this.emulator.isNetplay) return;
        if (player !== 0 && !resp) return;
        player = this.getUserIndex(this.playerID);
        let frame = this.currentFrame;
        if (this.owner) {
            if (!this.inputsData[frame]) {
                this.inputsData[frame] = [];
            }
            this.inputsData[frame].push({
                frame: frame,
                connected_input: [player, index, value]
            });
            this.emulator.gameManager.functions.simulateInput(player, index, value);
        } else {
            this.sendMessage({
                'sync-control': [{
                    frame: frame + 10,
                    connected_input: [player, index, value]
                }]
            });
        }
    }

    sendMessage(data) {
        if (this.webrtc) {
            this.webrtc.broadcast(data);
        }
    }

    reset() {
        this.init_frame = this.currentFrame;
        this.inputsData = {};
    }

    hookPostMainLoop() {
        this.init_frame = 0;
        this.currentFrame = 0;
        this.inputsData = {};
        this.emulator.Module.postMainLoop = () => {
            this.currentFrame = parseInt(this.emulator.gameManager.getFrameNum()) - this.init_frame;
            if (!this.emulator.isNetplay) return;
            if (this.owner) {
                let to_send = [];
                let i = this.currentFrame - 1;
                this.inputsData[i] ? this.inputsData[i].forEach((value) => {
                    value.frame += 10;
                    to_send.push(value);
                }) : to_send.push({ frame: i + 10 });
                this.sendMessage({ 'sync-control': to_send });
            } else {
                if (this.currentFrame <= 0 || this.inputsData[this.currentFrame]) {
                    this.wait = false;
                    this.emulator.play();
                    this.inputsData[this.currentFrame].forEach((value) => {
                        if (!value.connected_input) return;
                        this.emulator.gameManager.functions.simulateInput(value.connected_input[0], value.connected_input[1], value.connected_input[2]);
                    });
                } else if (!this.syncing) {
                    this.emulator.pause(true);
                    this.sendMessage({ sync: true });
                    this.syncing = true;
                }
            }
            if (this.currentFrame % 100 === 0) {
                Object.keys(this.inputsData).forEach(value => {
                    if (value < this.currentFrame - 50) {
                        this.inputsData[value] = null;
                        delete this.inputsData[value];
                    }
                });
            }
        };
    }
}

if (typeof window !== 'undefined') {
    window.EJS_Netplay = EJS_Netplay;
    window.EJS_NetplayManager = EJS_NetplayManager;
}
