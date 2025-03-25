import { useState } from "react";
import { chatbot } from "../../utils/functions/chatbot/chatbot.function";

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

interface InputProps {
    onResponse: (response: ChatResponse) => void;
    onUserMessage: (question: string) => void;
}

function Input({ onResponse, onUserMessage }: InputProps) {
    const [question, setQuestion] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (!question.trim()) return;
        
        const userQuestion = question.trim();
        setIsLoading(true);
        setError(null);
        console.log("Début de l'envoi de la question:", userQuestion);
        
        onUserMessage(userQuestion);
        
        try {
            const data = await chatbot.analyze(userQuestion);
            console.log("Réponse reçue:", data);
            onResponse(data as ChatResponse);
            setQuestion("");
        } catch (error) {
            console.error("Erreur lors de l'appel API:", error);
            setError("Erreur lors de l'envoi de la question");
        } finally {
            setIsLoading(false);
        }
    }

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e as unknown as React.MouseEvent<HTMLButtonElement>);
        }
    }

    return (
        <div className="flex flex-col gap-4 w-full mt-auto">
            <div className="flex gap-2">
                <input 
                    type="text" 
                    value={question} 
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="flex-1 p-2 border rounded"
                    placeholder="Posez votre question..."
                    disabled={isLoading}
                />
                <button 
                    onClick={handleSubmit}
                    className={`px-4 py-2 rounded text-white ${
                        isLoading 
                            ? "bg-gray-400 cursor-not-allowed" 
                            : "bg-blue-500 hover:bg-blue-600"
                    }`}
                    disabled={isLoading}
                >
                    {isLoading ? "Envoi..." : "Envoyer"}
                </button>
            </div>
            {error && <div className="text-red-500">{error}</div>}
        </div>
    )
}

export default Input