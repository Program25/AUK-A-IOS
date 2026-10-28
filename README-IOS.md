# AUK-A para iPhone

Mesmo app do Android (configuração BLE do foguete e da estação em solo + aba
**📱 Celular**), empacotado com **Capacitor 8**. A interface (`src/`) e a ponte BLE
(`native/`) são as mesmas; o que é novo é o plugin nativo em **Swift**
(`plugins/auk-phone/`), que faz o iPhone virar o periférico BLE `AUKA-PHONE/1`
e mandar o GPS para o laptop — o equivalente do `AukPhoneService.java`.

> ⚠️ **Este projeto não foi compilado nem testado aqui** (não há Mac/Xcode nem iPhone
> neste ambiente). O Swift foi só conferido quanto à sintaxe; o projeto iOS é gerado
> e montado normalmente. Se o primeiro build no GitHub falhar, mande o log do passo
> que deu erro. A parte Bluetooth/GPS precisa de teste real (ver o fim deste arquivo).

---

## Passo 1 — Gerar o `.ipa` sem Mac (GitHub Actions)

O Xcode só roda em Mac, então quem compila é um Mac virtual do GitHub.

1. Crie um repositório no GitHub e envie o conteúdo desta pasta (**sem** `node_modules`;
   o `.gitignore` já cuida disso).
2. Aba **Actions → Gerar IPA (iPhone) → Run workflow** (roda também a cada push na `main`).
3. Espere uns 10 minutos. Ao terminar, baixe o artefato **AUK-A-ipa** (um `.zip` com
   `AUK-A-v1.4.0.ipa` dentro).

O `.ipa` sai **sem assinatura**; quem assina é o Sideloadly/AltStore com o seu Apple ID,
na hora de instalar (passo 2). Em repositório privado, os minutos de macOS do GitHub
custam mais que os de Linux — confira a sua cota; um build é curto.

Se um dia tiver um Mac: `npm install && npm run ipa` gera o mesmo arquivo em `dist/`.

---

## Passo 2 — Instalar no iPhone pelo Windows

### Antes de tudo
- **iTunes** instalado a partir do site da Apple (**não** o da Microsoft Store). Para o
  AltStore, instale também o **iCloud para Windows** do site da Apple.
- Cabo USB que transfira dados, iPhone desbloqueado e "Confiar neste computador".
- Um **Apple ID** (recomendo um secundário só para isso).
- **Modo Desenvolvedor** no iPhone (iOS 16+): *Ajustes → Privacidade e Segurança →
  Modo Desenvolvedor* → ligar → o iPhone reinicia → confirmar. A opção só aparece depois
  da primeira tentativa de instalar um app assinado assim; se não aparecer, tente a
  instalação, volte aqui e ligue.

### Opção A — Sideloadly (instala o `.ipa` direto)
1. Instale o Sideloadly (sideloadly.io) e abra com o iPhone conectado.
2. Arraste o `AUK-A-v1.4.0.ipa` para a janela, digite o Apple ID e clique em **Start**
   (pede a senha e o código de verificação em duas etapas).
3. **Marque a renovação automática** (*Automatic app refresh*) antes de iniciar — ver abaixo.
4. No iPhone: *Ajustes → Geral → VPN e Gerenciamento de Dispositivo* (o nome muda um pouco
   conforme a versão do iOS) → toque no seu Apple ID → **Confiar**.

### Opção B — AltStore / AltServer
1. Instale o AltServer (altstore.io) e, pelo ícone na bandeja → **Install AltStore**,
   instale o AltStore no iPhone com o seu Apple ID.
2. Confie no perfil como acima. Mande o `.ipa` para o iPhone (AirDrop não existe no
   Windows; use cabo, Drive, e-mail...), abra no app **Arquivos** → **Compartilhar →
   AltStore**. Ou, no PC, bandeja do AltServer → **Sideload .ipa**.

### Limites da conta grátis (Apple)
- A assinatura vale **7 dias**; depois o app para de abrir até ser renovado.
- No máximo **3 apps** ativos assinados com o mesmo Apple ID grátis.

### Renovar a cada 7 dias
- **Sideloadly:** com a renovação automática marcada, deixe o Sideloadly aberto no PC e
  o iPhone acessível (USB, ou no mesmo Wi-Fi com a sincronização Wi-Fi ligada no iTunes).
- **AltStore:** deixe o AltServer rodando no PC, com o iPhone no mesmo Wi-Fi; o AltStore
  renova sozinho (ou toque em *Refresh All* no app).
- **Manual:** instale de novo o mesmo `.ipa` com o mesmo Apple ID — mantém os dados.
- **Não deixe vencer perto de um lançamento.** Renove no dia anterior.

---

## Usando

**Configurar foguete / estação em solo:** igual ao Android (*Conectar ao foguete*). O
iPhone pede permissão de Bluetooth na primeira vez.

**Enviar posição ao laptop (aba 📱 Celular):**
1. Ligue o interruptor. O iPhone pede **Localização** (escolha **Ao Usar o App** e deixe
   **Localização Precisa** ligada) e **Bluetooth**.
2. **Com o AUK-A aberto e a tela ligada**, no laptop: Telemetria → **📱 Celular** →
   `AUKA-PHONE`.
3. Depois que o laptop conectar, pode bloquear a tela: o envio continua (aparece a barra
   azul de localização).

### O que é diferente do Android (regras do iOS, não dá para contornar)
| | Android | iPhone |
|---|---|---|
| Ser encontrado pelo laptop | sempre | **só com o app aberto** (em segundo plano o iOS tira o nome/UUID do anúncio) |
| Conexão já feita + tela bloqueada | segue | segue (modos de fundo `location` + `bluetooth-peripheral`) |
| Reconexão com tela bloqueada | funciona | **abra o app antes de reconectar** |
| Fonte da posição | só GPS | o iOS escolhe; posição pior que **20 m** vira `NOFIX` (para não mandar Wi-Fi/antena como se fosse GPS) |
| Desligar o interruptor | desconecta o laptop | o laptop pode ficar "conectado" sem receber nada (a tela dele mostra "sem atualização há N s") — desconecte lá |
| Aviso fixo | notificação | barra azul de localização |
| Nome `AUKA-PHONE` | vira o nome Bluetooth do celular | só o nome *anunciado*; o nome do iPhone não muda |
| "Conectado" na tela | conexão | quem **se inscreveu** (o iOS não avisa de conexões sem inscrição) |

Enquanto o envio está ligado e o app aberto, a tela do iPhone **não** bloqueia sozinha
(para o laptop conseguir achá-lo); você pode bloquear manualmente.

### Teste de aceitação
1. **nRF Connect** em outro celular: aparece `AUKA-PHONE`; conectar; serviço `7b5c0400…`
   e característica `7b5c0401…` existem; ativar notificações → chega uma linha CSV por segundo.
2. Dentro de um prédio chega `NOFIX,<ms>`; ao ar livre, a posição com precisão < 10 m.
3. Desligar o interruptor e religar funciona sem reiniciar o app.
4. No AUK-A do laptop: Telemetria → 📱 Celular → `AUKA-PHONE` → posição no mapa.

### O que conferir no primeiro teste real
- **Nome no anúncio:** UUID de 128 bits + nome de 10 letras é apertado; o iOS pode
  encurtar o nome ou mandá-lo na resposta de varredura. O laptop filtra pelo UUID, então
  deve achar mesmo assim, mas confira o que aparece na lista.
- **Atualização parada:** com o iPhone imóvel, veja se continua chegando posição a cada
  segundo (se o iOS espaçar demais, um fix com mais de 5 s vira `NOFIX`).
- **Precisão a céu aberto:** se ficar acima de 20 m por muito tempo, suba
  `maxAccuracyM` em `AukPhonePlugin.swift`.

---

## Estrutura

```
src/                       interface (HTML/CSS/JS) — igual ao Android, com textos do iOS
native/                    ponte BLE (central) + salvar arquivo + ponte "posição ao laptop"
plugins/auk-phone/         plugin Capacitor em Swift (SPM): periférico BLE + GPS
  ios/Sources/AukPhonePlugin/AukPhonePlugin.swift   GATT server, anúncio, GPS, 1 Hz
  ios/Sources/AukPhonePlugin/PhonePayload.swift     formata os textos do protocolo
tests/swift/main.swift     teste dos textos (roda no passo do GitHub; `npm run test:payload` no Mac)
scripts/                   build-web, patch-ios (Info.plist/versão), build-ios (xcodebuild -> .ipa)
.github/workflows/         build-ipa.yml
```
`cap add ios` e `cap sync` geram a pasta `ios/` a cada build (ela não vai para o Git).
O `patch-ios.mjs` põe no `Info.plist` os textos de permissão (Bluetooth e Localização) e
os modos de segundo plano; o plugin é registrado sozinho pelo `cap sync`.

Para mudar um campo de configuração, edite só `src/fields.js` / `src/groundFields.js`.
Esta pasta tem **cópia** do `src/` e do `native/` do projeto Android; se mudar a
interface lá, repita aqui.
