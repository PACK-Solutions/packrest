// Plain-language help for HTTP status codes, aimed at non-developers.
// Shared by the response panel (inline, at the moment of an error) and the
// Help page (full reference table). Returns `null` for successful/redirect
// responses (1xx–3xx) where no diagnosis is needed; produces an entry for the
// synthetic `status: 0` network failure (see lib/http.ts) and every 4xx/5xx.

export interface StatusHelp {
  // Short human title, e.g. "Accès refusé".
  title: string;
  // What the code means, in one or two plain sentences.
  explanation: string;
  // Concrete next step for the user. Omitted when there is nothing actionable.
  action?: string;
}

// Specific, hand-written entries for the codes users actually hit.
const SPECIFIC: Record<number, StatusHelp> = {
  0: {
    title: "Requête non aboutie",
    explanation:
      "La requête n'a pas pu joindre le serveur : réseau indisponible, hôte injoignable, ou délai d'attente dépassé.",
    action:
      "Vérifiez votre connexion et l'URL de base (environnement Dev/Rec), puis réessayez.",
  },
  400: {
    title: "Requête invalide",
    explanation:
      "Le serveur a rejeté la requête : un paramètre ou le corps envoyé est mal formé ou incomplet.",
    action:
      "Vérifiez les champs du formulaire et le corps de la requête, puis relancez.",
  },
  401: {
    title: "Non authentifié",
    explanation:
      "Le token est absent, expiré ou invalide — le serveur ne sait pas qui vous êtes.",
    action: "Cliquez sur « Obtenir un token » pour en générer un nouveau.",
  },
  402: {
    title: "Paiement requis",
    explanation:
      "L'accès à cette ressource nécessite un abonnement ou un quota qui n'est pas satisfait.",
    action: "Contactez l'équipe de l'API.",
  },
  403: {
    title: "Accès refusé",
    explanation:
      "Vous êtes bien authentifié mais pas autorisé : le token n'a probablement pas le bon scope, ou l'action est interdite pour votre compte.",
    action:
      "Vérifiez les scopes sélectionnés avant d'obtenir le token, ou contactez l'équipe de l'API.",
  },
  404: {
    title: "Introuvable",
    explanation:
      "La ressource demandée n'existe pas — l'URL ou un identifiant de chemin est sans doute incorrect.",
    action: "Vérifiez l'URL et les paramètres de chemin.",
  },
  405: {
    title: "Méthode non autorisée",
    explanation:
      "Cette méthode HTTP (GET, POST, …) n'est pas permise sur cette URL.",
  },
  409: {
    title: "Conflit",
    explanation:
      "La requête entre en conflit avec l'état actuel de la ressource — par exemple un doublon ou une modification concurrente.",
  },
  410: {
    title: "Ressource supprimée",
    explanation: "La ressource a existé mais a été définitivement supprimée.",
  },
  415: {
    title: "Format non supporté",
    explanation: "Le type de contenu envoyé n'est pas accepté par le serveur.",
    action: "Vérifiez l'en-tête Content-Type de la requête.",
  },
  422: {
    title: "Données non traitables",
    explanation:
      "La syntaxe est correcte mais les données ne respectent pas les règles métier de l'API.",
    action: "Corrigez les valeurs signalées dans le corps de la réponse.",
  },
  429: {
    title: "Trop de requêtes",
    explanation: "Vous avez dépassé la limite de débit autorisée par l'API.",
    action: "Patientez un instant avant de réessayer.",
  },
  500: {
    title: "Erreur serveur",
    explanation:
      "Le serveur a rencontré une erreur interne — ce n'est pas votre faute.",
    action:
      "Réessayez plus tard ; si cela persiste, transmettez le détail ci-dessous à l'équipe de l'API.",
  },
  501: {
    title: "Non implémenté",
    explanation: "Le serveur ne sait pas encore traiter cette requête.",
  },
  502: {
    title: "Passerelle en erreur",
    explanation:
      "Une passerelle ou un proxy a reçu une réponse invalide du serveur amont.",
    action: "Réessayez ; le problème est côté infrastructure.",
  },
  503: {
    title: "Service indisponible",
    explanation:
      "Le service est momentanément indisponible (maintenance ou surcharge).",
    action: "Réessayez plus tard.",
  },
  504: {
    title: "Délai de passerelle dépassé",
    explanation: "Le serveur amont a mis trop de temps à répondre.",
    action: "Réessayez plus tard.",
  },
};

// Generic fallbacks per family, used when the exact code isn't in SPECIFIC.
function bucket(code: number): StatusHelp | null {
  if (code >= 400 && code < 500)
    return {
      title: "Requête refusée",
      explanation:
        "Le serveur a refusé la requête à cause de quelque chose dans la demande (paramètres, autorisation, ressource).",
      action: "Vérifiez la requête envoyée et le corps de la réponse.",
    };
  if (code >= 500)
    return {
      title: "Erreur serveur",
      explanation:
        "Le serveur a rencontré un problème — ce n'est pas votre faute.",
      action: "Réessayez plus tard ; contactez l'équipe de l'API si cela persiste.",
    };
  return null;
}

// Diagnosis for a response status. Null for 1xx–3xx (nothing to explain).
export function statusHelp(code: number): StatusHelp | null {
  if (code in SPECIFIC) return SPECIFIC[code];
  if (code > 0 && code < 400) return null;
  return bucket(code);
}

// Codes surfaced in the Help page reference table (network failure first).
export const COMMON_STATUS_CODES: number[] = [
  0, 400, 401, 402, 403, 404, 409, 415, 422, 429, 500, 502, 503, 504,
];
