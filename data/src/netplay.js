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
