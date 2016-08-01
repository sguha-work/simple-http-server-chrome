window.onload = function () {
    var hosts,
        port,
        directory,
        tcpServer,
        tcpSocket,
        serverSocketId,
        filesMap,
        stringToArray,
        arrayToString,
        logToScreen,
        destroySocketById,
        closeServerSocket,
        sendReplyToSocket,
        getResponseHeader,
        getErrorHeader,
        getSuccessHeader,
        writeErrorResponse,
        write200Response,
        onAccept,
        onReceive,
        startServer;


    hosts = "127.0.0.1",
    port = "8080",
    directory = document.getElementById("directory");
    tcpServer = chrome.sockets.tcpServer;
    tcpSocket = chrome.sockets.tcp;

    serverSocketId = null;
    filesMap = {};

    stringToArray = function (string) {
        var buffer,
            view,
            index;
        buffer = new ArrayBuffer(string.length);
        view = new Uint8Array(buffer);
        for (index = 0; index < string.length; index++) {
            view[index] = string.charCodeAt(index);
        }
        return view;
    };

    arrayToString = function (buffer) {
        var str,
            uArrayVal,
            index;
        str = ''
        uArrayVal = new Uint8Array(buffer);
        for (index = 0; index < uArrayVal.length; index++) {
            str += String.fromCharCode(uArrayVal[index]);
        }
        return str;
    };

    logToScreen = function (log) {
        logger.textContent += log + "\n";
        logger.scrollTop = logger.scrollHeight;
    };

    destroySocketById = function (socketId) {
        tcpSocket.disconnect(socketId, function () {
            tcpSocket.close(socketId);
        });
    };

    closeServerSocket = function () {
        if (serverSocketId) {
            tcpServer.close(serverSocketId, function () {
                if (chrome.runtime.lastError) {
                    console.warn("chrome.sockets.tcpServer.close:", chrome.runtime.lastError);
                }
            });
        }

        tcpServer.onAccept.removeListener(onAccept);
        tcpSocket.onReceive.removeListener(onReceive);
    };

    sendReplyToSocket = function (socketId, buffer, keepAlive) {
        tcpSocket.getInfo(socketId, function (socketInfo) {
            if (!socketInfo.connected) {
                destroySocketById(socketId);
                return;
            }

            tcpSocket.setKeepAlive(socketId, keepAlive, 1, function () {
                if (!chrome.runtime.lastError) {
                    tcpSocket.send(socketId, buffer, function (writeInfo) {
                        console.log("WRITE", writeInfo);

                        if (!keepAlive || chrome.runtime.lastError) {
                            destroySocketById(socketId);
                        }
                    });
                }
                else {
                    console.warn("chrome.sockets.tcp.setKeepAlive:", chrome.runtime.lastError);
                    destroySocketById(socketId);
                }
            });
        });
    };

    getResponseHeader = function (file, errorCode, keepAlive) {
        var httpStatus,
            contentType,
            contentLength,
            lines;

        httpStatus = "HTTP/1.0 200 OK";
        contentType = "text/plain";
        contentLength = 0;

        if (!file || errorCode) {
            httpStatus = "HTTP/1.0 " + (errorCode || 404) + " Not Found";
        }
        else {
            contentType = file.type || contentType;
            contentLength = file.size;
        }

        lines = [
            httpStatus,
            "Content-length: " + contentLength,
            "Content-type:" + contentType
        ];

        if (keepAlive) {
            lines.push("Connection: keep-alive");
        }

        return stringToArray(lines.join("\n") + "\n\n");
    };

    getErrorHeader = function (errorCode, keepAlive) {
        return getResponseHeader(null, errorCode, keepAlive);
    };

    getSuccessHeader = function (file, keepAlive) {
        return getResponseHeader(file, null, keepAlive);
    };

    writeErrorResponse = function (socketId, errorCode, keepAlive) {
        var header,
            outputBuffer,
            view;
        
        header = getErrorHeader(errorCode, keepAlive);
        console.info("writeErrorResponse:: begin... ");
        console.info("writeErrorResponse:: Done setting header...");
        outputBuffer = new ArrayBuffer(header.byteLength);
        view = new Uint8Array(outputBuffer);
        view.set(header, 0);
        console.info("writeErrorResponse:: Done setting view...");

        sendReplyToSocket(socketId, outputBuffer, keepAlive);

        console.info("writeErrorResponse::filereader:: end onload...");
        console.info("writeErrorResponse:: end...");
    };

    write200Response = function (socketId, file, keepAlive) {
        var header,
            outputBuffer,
            view,
            fileReader;

        header = getSuccessHeader(file, keepAlive);
        outputBuffer = new ArrayBuffer(header.byteLength + file.size);
        view = new Uint8Array(outputBuffer);
        view.set(header, 0);

        fileReader = new FileReader();
        fileReader.onload = function (e) {
            view.set(new Uint8Array(e.target.result), header.byteLength);
            sendReplyToSocket(socketId, outputBuffer, keepAlive);
        };

        fileReader.readAsArrayBuffer(file);
    };

    onAccept = function (acceptInfo) {
        tcpSocket.setPaused(acceptInfo.clientSocketId, false);

        if (acceptInfo.socketId != serverSocketId)
            return;

        console.log("ACCEPT", acceptInfo);
    };

    onReceive = function (receiveInfo) {
        
        var socketId,
            data,
            keepAlive,
            uriEnd,
            uri,
            q,
            file;

        console.log("READ", receiveInfo);
        socketId = receiveInfo.socketId;

        data = arrayToString(receiveInfo.data);
        
        if (data.indexOf("GET ") !== 0) {
            destroySocketById(socketId);
            return;
        }

        keepAlive = false;
        if (data.indexOf("Connection: keep-alive") != -1) {
            keepAlive = true;
        }

        uriEnd = data.indexOf(" ", 4);
        if (uriEnd < 0) { return; }
        uri = data.substring(4, uriEnd);
        
        q = uri.indexOf("?");
        if (q != -1) {
            uri = uri.substring(0, q);
        }
        file = filesMap[uri];
        if (!!file == false) {
            console.warn("File does not exist..." + uri);
            writeErrorResponse(socketId, 404, keepAlive);
            return;
        }
        logToScreen("GET 200 " + uri);
        write200Response(socketId, file, keepAlive);

    };
    startServer = (function () {

        tcpServer.create({}, function (socketInfo) {
            serverSocketId = socketInfo.socketId;

            tcpServer.listen(serverSocketId, hosts, parseInt(port, 10), 50, function (result) {
                console.log("LISTENING:", result);

                tcpServer.onAccept.addListener(onAccept);
                tcpSocket.onReceive.addListener(onReceive);
            });
        });



    });

    directory.onchange = function (e) {
        
        var files,
            index;

        closeServerSocket();

        files = e.target.files;

        for (index = 0; index < files.length; index++) {
            //remove the first first directory
            var path = files[index].webkitRelativePath;
            if (path && path.indexOf("/") >= 0) {
                filesMap[path.substr(path.indexOf("/"))] = files[index];
            } else {
                filesMap["/" + files[index].fileName] = files[index];
            }
        }
        startServer();
    };



    window.addEventListener('onbeforeunload', function (event) {
        closeServerSocket();
    }, false);

};
