"use client";

import Link from "next/link";
import {
  Info,
  ListChecks,
  KeyRound,
  AlertTriangle,
  Database,
  Wrench,
} from "lucide-react";

import { Card, CardHeader, CardBody } from "@/components/Card";
import StatusBadge from "@/components/StatusBadge";
import { statusHelp, COMMON_STATUS_CODES } from "@/lib/status-help";

// Static help / diagnostic page. Client component to stay consistent with the
// rest of the static export; it reuses `statusHelp` so the status-code
// reference here and the inline explanation in the response panel never drift.

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-primary text-primary-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
        {n}
      </span>
      <span className="text-sm">{children}</span>
    </li>
  );
}

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="from-foreground to-muted-foreground bg-gradient-to-r bg-clip-text text-2xl font-semibold text-transparent">
          Aide &amp; diagnostic
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Comment utiliser PackRest et comprendre les réponses des APIs.
        </p>
      </header>

      <Card>
        <CardHeader>
          <Info className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Qu&apos;est-ce que PackRest ?</span>
        </CardHeader>
        <CardBody className="space-y-2 p-4 text-sm">
          <p>
            PackRest est une <strong>application de bureau</strong>{" "}
            qui charge les contrats OpenAPI des APIs Pack Solutions et vous
            permet de les
            appeler sans écrire de code. Tout se passe sur votre machine : il
            n&apos;y a pas de serveur intermédiaire.
          </p>
          <p className="text-muted-foreground">
            Les exemples déclarés dans chaque contrat pré-remplissent les
            formulaires : dans la plupart des cas, vous n&apos;avez qu&apos;à
            obtenir un token puis exécuter.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <ListChecks className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Comment ça marche</span>
        </CardHeader>
        <CardBody className="p-4">
          <ol className="space-y-2.5">
            <Step n={1}>
              Choisissez une <strong>API</strong> dans le menu de gauche.
            </Step>
            <Step n={2}>
              Choisissez un <strong>endpoint</strong> (une action) dans la liste.
            </Step>
            <Step n={3}>
              Vérifiez le <strong>formulaire</strong> pré-rempli à partir des
              exemples du contrat, et ajustez si besoin.
            </Step>
            <Step n={4}>
              Cliquez sur <strong>« Obtenir un token »</strong> (les scopes
              requis sont déjà cochés). Le clientId / clientSecret se
              renseignent une fois dans{" "}
              <Link href="/settings" className="underline">
                Paramètres
              </Link>
              .
            </Step>
            <Step n={5}>
              <strong>Exécutez</strong> la requête et lisez la réponse dans le
              panneau de droite.
            </Step>
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <KeyRound className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Les scopes OAuth2</span>
        </CardHeader>
        <CardBody className="space-y-2 p-4 text-sm">
          <p>
            Un <strong>scope</strong>{" "}
            est une permission : il indique à l&apos;API ce que votre token a le
            droit de faire (par exemple lire
            ou modifier une fiche). Chaque endpoint déclare les scopes dont il a
            besoin.
          </p>
          <p className="text-muted-foreground">
            Dans le panneau <em>Authentification</em>, les scopes{" "}
            <strong>requis</strong>{" "}
            par l&apos;opération sont déjà cochés — en cas de doute, laissez la
            sélection telle quelle. Les scopes{" "}
            <strong>optionnels</strong> ne sont utiles que si vous en avez
            explicitement besoin. Un token sans le bon scope reçoit une réponse{" "}
            <strong>403 (Accès refusé)</strong>.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <AlertTriangle className="text-muted-foreground size-3.5" />
          <span className="font-semibold">
            Comprendre les codes de réponse
          </span>
        </CardHeader>
        <CardBody className="p-4">
          <p className="text-muted-foreground mb-3 text-sm">
            Le panneau de réponse affiche ces explications automatiquement. Le
            corps complet, les en-têtes et la requête envoyée restent toujours
            consultables dans les onglets.
          </p>
          <ul className="divide-border divide-y">
            {COMMON_STATUS_CODES.map((code) => {
              const help = statusHelp(code);
              if (!help) return null;
              return (
                <li key={code} className="flex gap-3 py-2.5">
                  <span className="w-24 shrink-0 pt-0.5">
                    {code === 0 ? (
                      <StatusBadge label="Réseau" tone="danger" size="sm" />
                    ) : (
                      <StatusBadge code={code} size="sm" />
                    )}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{help.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {help.explanation}
                    </p>
                    {help.action && (
                      <p className="text-foreground/80 mt-0.5 text-xs">
                        → {help.action}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Wrench className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Diagnostic rapide</span>
        </CardHeader>
        <CardBody className="space-y-3 p-4 text-sm">
          <div>
            <p className="font-semibold">Aucune API n&apos;apparaît</p>
            <p className="text-muted-foreground">
              Les contrats ne sont pas encore synchronisés. Utilisez le bouton de
              synchronisation en haut, ou configurez une source dans{" "}
              <Link href="/settings" className="underline">
                Paramètres
              </Link>
              .
            </p>
          </div>
          <div>
            <p className="font-semibold">
              « Impossible d&apos;obtenir un token »
            </p>
            <p className="text-muted-foreground">
              Vérifiez le clientId / clientSecret dans Paramètres et
              l&apos;environnement sélectionné (Dev / Rec). Le message d&apos;erreur
              reprend la réponse de l&apos;IAM pour vous aider.
            </p>
          </div>
          <div>
            <p className="font-semibold">Le token vient d&apos;expirer</p>
            <p className="text-muted-foreground">
              La pastille en haut du panneau d&apos;authentification affiche le
              temps restant. Recliquez sur « Obtenir un token » pour en générer
              un nouveau.
            </p>
          </div>
          <div>
            <p className="font-semibold">Réponse « Échec réseau »</p>
            <p className="text-muted-foreground">
              La requête n&apos;a pas atteint le serveur : vérifiez votre
              connexion et l&apos;URL de base de l&apos;environnement.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Database className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Où sont stockées mes données ?</span>
        </CardHeader>
        <CardBody className="space-y-2 p-4 text-sm">
          <p>
            Vos réglages (clientId, clientSecret, token, configuration GitLab)
            sont conservés <strong>localement sur cette machine</strong> par
            l&apos;application, sans transiter par un serveur.
          </p>
          <p className="text-muted-foreground">
            Les contrats synchronisés sont écrits dans le dossier de données de
            l&apos;application. Les requêtes ne sont pas enregistrées :
            l&apos;échange se fait via l&apos;export / import de collections
            Bruno.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
