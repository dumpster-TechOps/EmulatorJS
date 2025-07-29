class EJS_NETPLAY {
    constructor(EJS) {
        this.EJS = EJS;
        this.url = EJS.config.netplayUrl;
        while (this.url.endsWith('/')) this.url = this.url.substring(0, this.url.length - 1);
        this.name = EJS.config.netplayName || '';
        this.playerID = EJS.config.netplayGuid || this.guidGenerator();
        this.token = EJS.config.netplayToken;
        this.spectator = !!EJS.config.netplaySpectator;
        this.current_frame = 0;
        this.init_frame = 0;
        this.currentFrame = 0;
        this.inputsData = {};
        this.inputs = {};
        EJS.Module.postMainLoop = this.postMainLoop.bind(this);
    }

    guidGenerator() {
        const S4 = function() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        };
        return (S4() + S4() + '-' + S4() + '-' + S4() + '-' + S4() + '-' + S4() + S4() + S4());
    }

    startSocketIO(callback) {
        const opts = {};
        if (this.token) opts.auth = { token: this.token };
        this.socket = io(this.url, opts);
        this.socket.on('connect', () => callback());
        this.socket.on('joined', info => {
            this.players[info.guid] = info;
            this.updatePlayersTable();
        });
        this.socket.on('user-joined', info => {
            this.players[info.guid] = info;
            this.updatePlayersTable();
        });
        this.socket.on('user-left', info => {
            delete this.players[info.guid];
            this.updatePlayersTable();
        });
        this.socket.on('disconnect', () => this.roomLeft());
    }

    openRoom(roomName, maxPlayers, password) {
        const sessionid = this.guidGenerator();
        this.playerID = this.guidGenerator();
        this.players = {};
        this.extra = {
            domain: window.location.host,
            game_id: this.EJS.config.gameId,
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
            }, err => {
                if (err) {
                    if (this.EJS.debug) console.log('error: ', err);
                    return;
                }
                this.roomJoined(true, roomName, password, sessionid);
            });
        });
    }

    leaveRoom() {
        if (this.EJS.debug) console.log('asd');
        this.roomLeft();
    }

    joinRoom(sessionid, roomName) {
        this.playerID = this.guidGenerator();
        this.players = {};
        this.extra = {
            domain: window.location.host,
            game_id: this.EJS.config.gameId,
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
            }, err => {
                if (err) {
                    if (this.EJS.debug) console.log('error: ', err);
                    return;
                }
                this.roomJoined(false, roomName, '', sessionid);
            });
        });
    }

    roomJoined(isOwner, roomName, password) {
        this.EJS.isNetplay = true;
        this.inputs = {};
        this.owner = isOwner;
        if (this.EJS.debug) console.log(this.extra);
        this.roomNameElem.innerText = roomName;
        this.tabs[0].style.display = 'none';
        this.tabs[1].style.display = '';
        if (password) {
            this.passwordElem.style.display = '';
            this.passwordElem.innerText = this.EJS.localization('Password') + ': ' + password;
        } else {
            this.passwordElem.style.display = 'none';
        }
        this.createButton.innerText = this.EJS.localization('Leave Room');
        this.updatePlayersTable();
        if (!this.owner) {
            this.oldStyles = [
                this.EJS.elements.bottomBar.cheat[0].style.display,
                this.EJS.elements.bottomBar.playPause[0].style.display,
                this.EJS.elements.bottomBar.playPause[1].style.display,
                this.EJS.elements.bottomBar.restart[0].style.display,
                this.EJS.elements.bottomBar.loadState[0].style.display,
                this.EJS.elements.bottomBar.saveState[0].style.display,
                this.EJS.elements.bottomBar.saveSavFiles[0].style.display,
                this.EJS.elements.bottomBar.loadSavFiles[0].style.display,
                this.EJS.elements.contextMenu.save.style.display,
                this.EJS.elements.contextMenu.load.style.display
            ];
            this.EJS.elements.bottomBar.cheat[0].style.display = 'none';
            this.EJS.elements.bottomBar.playPause[0].style.display = 'none';
            this.EJS.elements.bottomBar.playPause[1].style.display = 'none';
            this.EJS.elements.bottomBar.restart[0].style.display = 'none';
            this.EJS.elements.bottomBar.loadState[0].style.display = 'none';
            this.EJS.elements.bottomBar.saveState[0].style.display = 'none';
            this.EJS.elements.bottomBar.saveSavFiles[0].style.display = 'none';
            this.EJS.elements.bottomBar.loadSavFiles[0].style.display = 'none';
            this.EJS.elements.contextMenu.save.style.display = 'none';
            this.EJS.elements.contextMenu.load.style.display = 'none';
            this.EJS.gameManager.resetCheat();
        } else {
            this.oldStyles = [
                this.EJS.elements.bottomBar.cheat[0].style.display
            ];
        }
        this.EJS.elements.bottomBar.cheat[0].style.display = 'none';
    }

    updatePlayersTable() {
        const table = this.playerTable;
        table.innerHTML = '';
        const addRow = (num, playerName) => {
            const row = this.EJS.createElement('tr');
            const addCell = text => {
                const item = this.EJS.createElement('td');
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
                addRow(this.EJS.localization('Viewer'), name);
            } else {
                addRow(this.EJS.localization('Player') + ' ' + info.player, name);
            }
        }
    }

    roomLeft() {
        this.EJS.isNetplay = false;
        this.tabs[0].style.display = '';
        this.tabs[1].style.display = 'none';
        this.extra = null;
        this.playerID = null;
        this.spectator = !!this.EJS.config.netplaySpectator;
        this.createButton.innerText = this.EJS.localization('Create a Room');
        if (this.socket) this.socket.disconnect();
        this.EJS.elements.bottomBar.cheat[0].style.display = this.oldStyles[0];
        if (!this.owner) {
            this.EJS.elements.bottomBar.playPause[0].style.display = this.oldStyles[1];
            this.EJS.elements.bottomBar.playPause[1].style.display = this.oldStyles[2];
            this.EJS.elements.bottomBar.restart[0].style.display = this.oldStyles[3];
            this.EJS.elements.bottomBar.loadState[0].style.display = this.oldStyles[4];
            this.EJS.elements.bottomBar.saveState[0].style.display = this.oldStyles[5];
            this.EJS.elements.bottomBar.saveSavFiles[0].style.display = this.oldStyles[6];
            this.EJS.elements.bottomBar.loadSavFiles[0].style.display = this.oldStyles[7];
            this.EJS.elements.contextMenu.save.style.display = this.oldStyles[8];
            this.EJS.elements.contextMenu.load.style.display = this.oldStyles[9];
        }
        this.EJS.updateCheatUI();
    }

    setLoading(loading) {
        if (this.EJS.debug) console.log('loading:', loading);
    }

    async sync() {
        if (this._syncing) return;
        this._syncing = true;
        if (this.EJS.debug) console.log('sync');
        this.ready = 0;
        const state = this.EJS.gameManager.getState();
        this.sendMessage({ state });
        this.setLoading(true);
        this.EJS.pause(true);
        this.ready++;
        this.current_frame = 0;
        if (this.ready === this.getUserCount()) {
            this.EJS.play(true);
        }
        this._syncing = false;
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
            this.EJS.pause(true);
            this.EJS.gameManager.loadState(new Uint8Array(data.state));
            this.sendMessage({ ready: true });
        }
        if (data.play && !this.owner) {
            this.EJS.play(true);
        }
        if (data.pause && !this.owner) {
            this.EJS.pause(true);
        }
        if (data.ready && this.owner) {
            this.ready++;
            if (this.ready === this.getUserCount()) {
                this.sendMessage({ readyready: true });
                this.reset();
                setTimeout(() => this.EJS.play(true), 48);
                this.setLoading(false);
            }
        }
        if (data.readyready) {
            this.setLoading(false);
            this.reset();
            this.EJS.play(true);
        }
        if (data.shortPause && data.shortPause !== this.playerID) {
            this.EJS.pause(true);
            this.wait = true;
            setTimeout(() => this.EJS.play(true), 48);
        }
        if (data['sync-control']) {
            data['sync-control'].forEach(value => {
                let inFrame = parseInt(value.frame);
                let frame = this.currentFrame;
                if (!value.connected_input || value.connected_input[0] < 0) return;
                if (inFrame === frame) {
                    inFrame++;
                    this.EJS.gameManager.functions.simulateInput(
                        value.connected_input[0],
                        value.connected_input[1],
                        value.connected_input[2]
                    );
                }
                this.inputsData[inFrame] || (this.inputsData[inFrame] = []);
                this.inputsData[frame] || (this.inputsData[frame] = []);
                if (this.owner) {
                    this.inputsData[frame].push(value);
                    this.EJS.gameManager.functions.simulateInput(
                        value.connected_input[0],
                        value.connected_input[1],
                        value.connected_input[2]
                    );
                    if (frame - 10 >= inFrame) {
                        this.wait = true;
                        this.EJS.pause(true);
                        setTimeout(() => {
                            this.EJS.play(true);
                            this.wait = false;
                        }, 48);
                    }
                } else {
                    this.inputsData[inFrame].push(value);
                    if (this.inputsData[frame]) {
                        this.EJS.play(true);
                    }
                    if (frame + 10 <= inFrame && inFrame > this.init_frame + 100) {
                        this.sendMessage({ shortPause: this.playerID });
                    }
                }
            });
        }
        if (data.restart) {
            this.EJS.gameManager.restart();
            this.reset();
            this.EJS.play(true);
        }
    }

    sendInput(player, index, value, resp) {
        if (!this.EJS.isNetplay) return;
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
            this.EJS.gameManager.functions.simulateInput(player, index, value);
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
        this.socket.emit('data-message', data);
    }

    reset() {
        this.init_frame = this.currentFrame;
        this.inputsData = {};
    }

    postMainLoop() {
        this.currentFrame = parseInt(this.EJS.gameManager.getFrameNum()) - this.init_frame;
        if (!this.EJS.isNetplay) return;
        if (this.owner) {
            let to_send = [];
            let i = this.currentFrame - 1;
            this.inputsData[i] ? this.inputsData[i].forEach(value => {
                value.frame += 10;
                to_send.push(value);
            }) : to_send.push({ frame: i + 10 });
            this.sendMessage({ 'sync-control': to_send });
        } else {
            if (this.currentFrame <= 0 || this.inputsData[this.currentFrame]) {
                this.wait = false;
                this.EJS.play();
                this.inputsData[this.currentFrame].forEach(value => {
                    if (!value.connected_input) return;
                    this.EJS.gameManager.functions.simulateInput(
                        value.connected_input[0],
                        value.connected_input[1],
                        value.connected_input[2]
                    );
                });
            } else if (!this.syncing) {
                this.EJS.pause(true);
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
    }
}

window.EJS_NETPLAY = EJS_NETPLAY;
