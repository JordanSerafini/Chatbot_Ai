import { useEffect, useState, useRef } from "react";
import Input from "./Input";
import Message from "./Message";

interface ResponseData {
  [key: string]: string | number | boolean | object | null;
}

interface ChatResponse {
  data: ResponseData[] | ResponseData;
  type: 'list' | 'detail';
  humanResponse?: string;
  success?: boolean;
  count?: number;
  sql?: string;
  description?: string;
}

interface ChatMessage {
  isUser: boolean;
  content: string | ChatResponse;
}

function Messagerie() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleNewResponse = (response: ChatResponse) => {
    // Ajouter la réponse du chatbot
    setMessages((prevMessages) => [...prevMessages, { isUser: false, content: response }]);
  };

  const handleUserMessage = (question: string) => {
    // Ajouter le message de l'utilisateur
    setMessages((prevMessages) => [...prevMessages, { isUser: true, content: question }]);
  };

  // Faire défiler vers le bas quand de nouveaux messages arrivent
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (messages.length > 0) {
      console.log("Nouvelle activité dans le chat:", messages[messages.length - 1]);
    }
  }, [messages]);

  return (
    <div className="bg-gray-200 w-9.5/10 h-9.5/10 rounded-lg shadow-md flex flex-col items-center justify-start p-2">
      <div className="w-full h-9.5/10 overflow-y-auto flex flex-col gap-4 mb-4 p-2">
        {messages.map((message, index) => (
          <div 
            key={index} 
            className={`${message.isUser ? 'self-end bg-blue-100' : 'self-start bg-white'} rounded-lg shadow-sm p-3 max-w-3/4`}
          >
            {message.isUser ? (
              <div className="text-gray-800">{message.content as string}</div>
            ) : (
              <Message response={message.content as ChatResponse} />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <Input onResponse={handleNewResponse} onUserMessage={handleUserMessage} />
    </div>
  );
}

export default Messagerie;
