import React, { useEffect, useState, useRef } from 'react';

const WebSocketExample: React.FC = () => {
    const [message, setMessage] = useState<string>('');
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8000/ws');
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket 连接已建立');
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            console.log('收到消息:', event.data);
        };

        ws.onerror = (error) => {
            console.error('WebSocket 错误:', error);
            setIsConnected(false);
        };

        ws.onclose = () => {
            console.log('WebSocket 连接已关闭');
            setIsConnected(false);
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, []);

    const sendMessage = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(message);
            setMessage(''); // 清空输入框
        } else {
            console.error('WebSocket 未连接');
        }
    };

    return (
        <div className="p-4">
            <h2 className="text-xl font-bold mb-4">WebSocket 示例</h2>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="输入消息"
                    className="border rounded px-2 py-1"
                />
                <button 
                    onClick={sendMessage}
                    disabled={!isConnected}
                    className={`px-4 py-1 rounded ${
                        isConnected 
                            ? 'bg-blue-500 text-white hover:bg-blue-600' 
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                >
                    发送消息
                </button>
            </div>
            <div className="mt-2">
                <span className={`inline-block px-2 py-1 rounded ${
                    isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                    {isConnected ? '已连接' : '未连接'}
                </span>
            </div>
        </div>
    );
};

export default WebSocketExample; 