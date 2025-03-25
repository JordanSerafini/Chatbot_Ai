import React from "react"

interface ResponseData {
    [key: string]: string | number | boolean | object | null;
}

interface MessageProps {
    response: {
        data: ResponseData[] | ResponseData;
        type: 'list' | 'detail';
        humanResponse?: string;
        success?: boolean;
        count?: number;
        sql?: string;
        description?: string;
    };
}

function Message({ response }: MessageProps) {
    // Gestion du cas où humanResponse est undefined
    const cleanResponse = response.humanResponse 
        ? response.humanResponse
            .replace(/^Tu es un assistant.*?français\./s, '')
            .replace(/^Voici les informations.*?naturelle\./s, '')
            .replace(/^Question :.*?naturelle\./s, '')
            .replace(/^Type de réponse :.*?naturelle\./s, '')
            .replace(/^Données :.*?naturelle\./s, '')
            .replace(/^IMPORTANT :.*?naturelle\./s, '')
            .replace(/^Instructions :.*?naturelle\./s, '')
            .replace(/^Réponse :.*?naturelle\./s, '')
            .trim()
        : response.description || '';

    // Fonction pour formater le contenu en fonction du type
    const renderContent = () => {
        // Afficher le texte nettoyé s'il existe
        if (cleanResponse) {
            return (
                <div className="text-gray-800 whitespace-pre-line mb-4">
                    {cleanResponse}
                </div>
            );
        }
        
        // Si pas de données, ne rien afficher de plus
        if (!response.data) return <div className="text-gray-600">Aucune donnée disponible</div>;
        
        // Affichage formaté selon le type
        if (response.type === 'list' && Array.isArray(response.data)) {
            return (
                <div className="mt-4">
                    <h3 className="font-semibold text-lg mb-2">Éléments trouvés: {response.count || response.data.length}</h3>
                    <ul className="list-disc pl-5 space-y-1">
                        {response.data.map((item, index) => (
                            <li key={index} className="text-gray-700">
                                {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                            </li>
                        ))}
                    </ul>
                </div>
            );
        } else if (response.type === 'detail' && typeof response.data === 'object') {
            return (
                <div className="mt-4">
                    <h3 className="font-semibold text-lg mb-2">Détails:</h3>
                    <div className="bg-gray-50 p-3 rounded border">
                        {Object.entries(response.data).map(([key, value]) => (
                            <div key={key} className="mb-2">
                                <span className="font-medium">{key}: </span>
                                <span>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            );
        } else {
            // Fallback pour tout autre type de données
            return (
                <div className="mt-4">
                    <h3 className="font-semibold text-lg mb-2">Résultat:</h3>
                    <pre className="bg-gray-50 p-3 rounded border overflow-x-auto">
                        {JSON.stringify(response.data, null, 2)}
                    </pre>
                </div>
            );
        }
    };

    return (
        <div className="bg-white p-4 w-full rounded-lg shadow-md">
            {renderContent()}
        </div>
    )
}

export default Message