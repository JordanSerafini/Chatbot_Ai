import React, { useMemo } from "react"

interface ResponseData {
    [key: string]: string | number | boolean | object | null;
}

interface MessageProps {
    response: {
        data: ResponseData[] | ResponseData;
        type: 'list' | 'detail';
        humanResponse?: string;
        textResponse?: string;
        success?: boolean;
        count?: number;
        sql?: string;
        description?: string;
        selectedQuery?: {
            question: string;
            sql: string;
            description: string;
        };
        alternativeQuestions?: string[];
    };
}

function Message({ response }: MessageProps) {
    console.log("Message component - response:", response);
    
    // Récupérer le texte de réponse brut
    const rawResponse = response.textResponse || response.humanResponse || response.description || '';
    
    // Extraire le type de données s'il est présent
    const dataType = useMemo(() => {
        const match = rawResponse.match(/<!--dataType:(.*?)-->/);
        return match ? match[1] : 'Non spécifié';
    }, [rawResponse]);
    
    // Fonction pour nettoyer la réponse
    const cleanTextResponse = (text: string): string => {
        return text
            // Supprimer le tag dataType
            .replace(/<!--dataType:.*?-->/g, '')
            // Supprimer les parties de réflexion en anglais et les instructions
            .replace(/\[Réponse\]/g, '')
            .replace(/\[Non.*instructions\.\]/g, '')
            .replace(/Okay, let's see.*one\./gs, '')
            .replace(/First, I need to.*individually\./gs, '')
            .replace(/<\/think>/g, '')
            .replace(/<think>.*<\/think>/gs, '')
            .replace(/\[.*?\]/g, '')
            .replace(/^.*?\bthink\b.*?$/gm, '')
            .replace(/^\s*Utilisateur:.*$/gm, '')
            .replace(/^\s*Assistant:.*$/gm, '')
            // Nettoyage des parties spécifiques au prompt
            .replace(/^Tu es un assistant.*?français\./s, '')
            .replace(/^Voici les informations.*?naturelle\./s, '')
            .replace(/^Question :.*?naturelle\./s, '')
            .replace(/^Type de réponse :.*?naturelle\./s, '')
            .replace(/^Données :.*?naturelle\./s, '')
            .replace(/^IMPORTANT :.*?naturelle\./s, '')
            .replace(/^Instructions :.*?naturelle\./s, '')
            .replace(/^Réponse :.*?naturelle\./s, '')
            .trim();
    };

    // Générer une description textuelle des données si aucune n'est fournie
    const generateTextSummary = (): string => {
        if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
            return "Aucune donnée disponible.";
        }
        
        // Pour les clients
        if (dataType === 'Customer') {
            const count = response.data.length;
            const projetsActifs = response.data.reduce((total, client) => {
                const activeProj = parseInt(String(client.active_projects || '0'), 10);
                return total + activeProj;
            }, 0);
            
            const exemples = response.data.slice(0, 3).map(client => 
                `${String(client.firstname || '')} ${String(client.lastname || '')}`
            ).join(', ');
            
            return `Nous avons ${count} clients avec des projets actifs dans notre système, pour un total de ${projetsActifs} projets. Parmi eux se trouvent ${exemples}${count > 3 ? ' et d\'autres' : ''}.`;
        }
        
        // Pour les autres types de données
        return `Nous avons trouvé ${response.data.length} résultat(s) correspondant à votre recherche.`;
    };

    // Nettoyer la réponse
    let cleanResponse = cleanTextResponse(rawResponse);
    
    // Si pas de réponse textuelle claire, générer une synthèse
    if (!cleanResponse || cleanResponse === response.description) {
        cleanResponse = generateTextSummary();
    }

    // Obtenir une icône basée sur le type de données
    const getDataTypeIcon = (type: string): string => {
        switch (type) {
            case 'Invoice':
            case 'Invoice_Summary':
                return '📄';
            case 'Quotation':
                return '📝';
            case 'Project':
                return '🏗️';
            case 'Planning':
                return '📅';
            case 'Staff':
                return '👷';
            case 'Finance':
                return '💰';
            case 'Customer':
                return '👥';
            case 'Customer_with_Projects':
                return '👥🏗️';
            default:
                return '📊';
        }
    };

    // Obtenir un libellé en français pour le type de données
    const getDataTypeLabel = (type: string): string => {
        switch (type) {
            case 'Invoice':
                return 'Facture';
            case 'Invoice_Summary':
                return 'Résumé de factures';
            case 'Quotation':
                return 'Devis';
            case 'Project':
                return 'Projet';
            case 'Planning':
                return 'Planning';
            case 'Staff':
                return 'Personnel';
            case 'Finance':
                return 'Finance';
            case 'Customer':
                return 'Clients';
            case 'Customer_with_Projects':
                return 'Clients avec projets';
            case 'Generic':
                return 'Données';
            case 'Unknown':
                return 'Type inconnu';
            default:
                return type;
        }
    };

    // Formater les clients pour un affichage personnalisé
    const formatClients = () => {
        if (!response.data || !Array.isArray(response.data)) return null;
        if (dataType !== 'Customer' && dataType !== 'Customer_with_Projects') return null;
        
        return (
            <div className="mt-4">
                <div className="space-y-3">
                    {response.data.map((client, index) => {
                        // Convertir les valeurs en types appropriés pour éviter les erreurs
                        const firstName = String(client.firstname || '');
                        const lastName = String(client.lastname || '');
                        const email = String(client.email || '');
                        const phone = client.phone ? String(client.phone) : '';
                        const id = String(client.id || '');
                        const activeProjects = parseInt(String(client.active_projects || '0'), 10);
                        
                        return (
                            <div key={index} className="bg-gray-50 p-3 rounded border">
                                <div className="flex items-center mb-2">
                                    <span className="text-lg font-semibold">
                                        {firstName} {lastName}
                                    </span>
                                    <span className="ml-auto bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                                        {activeProjects} projet{activeProjects > 1 ? 's' : ''} actif{activeProjects > 1 ? 's' : ''}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="flex items-center">
                                        <span className="text-gray-500 mr-2">📧</span>
                                        <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
                                            {email}
                                        </a>
                                    </div>
                                    {phone && (
                                        <div className="flex items-center">
                                            <span className="text-gray-500 mr-2">📞</span>
                                            <a href={`tel:${phone}`} className="text-blue-600 hover:underline">
                                                {phone}
                                            </a>
                                        </div>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500 mt-2">
                                    ID: {id}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Fonction pour formater le contenu en fonction du type
    const renderContent = () => {
        // Pour les clients, on affiche seulement le texte explicatif
        // Le formatage des cartes de clients est géré séparément par formatClients()
        if (dataType === 'Customer' || dataType === 'Customer_with_Projects') {
            return (
                <div className="text-gray-800 whitespace-pre-line mb-4">
                    {cleanResponse}
                </div>
            );
        }
        
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

    // Formater les dates dans les données pour un meilleur affichage (pour les types autres que Client)
    const formatData = () => {
        if (!response.data || !Array.isArray(response.data)) return null;
        
        // Pour les clients, on utilise formatClients() à la place
        if (dataType === 'Customer' || dataType === 'Customer_with_Projects') {
            return null;
        }
        
        return (
            <div className="mt-4">
                <div className="space-y-3">
                    {response.data.map((item, index) => (
                        <div key={index} className="bg-gray-50 p-3 rounded border">
                            {Object.entries(item).map(([key, value]) => {
                                // Formater les dates si la valeur ressemble à une date ISO
                                let displayValue = value;
                                if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
                                    try {
                                        displayValue = new Date(value).toLocaleDateString('fr-FR', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric'
                                        });
                                    } catch (e) {
                                        // En cas d'erreur, garder la valeur originale
                                    }
                                }
                                
                                // Formater les pourcentages
                                if (key.includes('percentage') && typeof value === 'number') {
                                    displayValue = `${Math.round(value * 100) / 100}%`;
                                }
                                
                                return (
                                    <div key={key} className="mb-1">
                                        <span className="font-medium">{key.replace(/_/g, ' ')}: </span>
                                        <span>{typeof displayValue === 'object' 
                                            ? JSON.stringify(displayValue) 
                                            : String(displayValue)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white p-4 w-full rounded-lg shadow-md">
            {/* Badge pour le type de données */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full flex items-center">
                    {getDataTypeIcon(dataType)} <span className="ml-1">{getDataTypeLabel(dataType)}</span>
                </span>
                {response.count && (
                    <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded-full">
                        {response.count} résultat{response.count > 1 ? 's' : ''}
                    </span>
                )}
            </div>
            
            {/* Contenu principal: d'abord le texte explicatif */}
            {renderContent()}
            
            {/* Pour les clients, utiliser le formatage spécial */}
            {(dataType === 'Customer' || dataType === 'Customer_with_Projects') && formatClients()}
            
            {/* Pour les autres types de données, utiliser le formatage standard */}
            {dataType !== 'Customer' && dataType !== 'Customer_with_Projects' && 
             Array.isArray(response.data) && response.data.length > 0 && formatData()}
        </div>
    )
}

export default Message