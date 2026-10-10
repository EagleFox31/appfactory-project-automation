# Changelog

## [1.5.0](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.4.0...v1.5.0) (2026-10-10)


### Features

* **aws:** 7-day disposable staging TTL and Free Plan cost guard ([#120](https://github.com/EagleFox31/appfactory-project-automation/issues/120)) ([02c1820](https://github.com/EagleFox31/appfactory-project-automation/commit/02c1820e3abfc933352656de85a58823777461b7))
* **aws:** aggregate real STS/IAM read-only evidence on GitHub runner ([1c7696f](https://github.com/EagleFox31/appfactory-project-automation/commit/1c7696f8c067f4b5f0baa9183dc75cefe2f191f5))
* **aws:** block staging readiness unless Free Plan and credits verified ([01fbefe](https://github.com/EagleFox31/appfactory-project-automation/commit/01fbefe4197fccf7fd1d3d480ba8ae271ab32695))
* **aws:** central least-privilege OIDC staging IAM provisioner and approved workflow ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([65ee3b5](https://github.com/EagleFox31/appfactory-project-automation/commit/65ee3b5f0b6982c467dd96592dc8f764e2b43462))
* **aws:** evolve existing central IAM stack with Précis OIDC, CloudFormation, SSM boundaries ([e1e5b1f](https://github.com/EagleFox31/appfactory-project-automation/commit/e1e5b1f455eca9523af0696ff768c9ba6bfe6ee2))
* **aws:** fail-closed automatic STS/Free Plan verification without resource writes ([54d002f](https://github.com/EagleFox31/appfactory-project-automation/commit/54d002f43141cfe5224ac77678bfd388c6c5909e))
* **aws:** fail-closed read-only Free Plan and credits gate for staging ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([c71ac96](https://github.com/EagleFox31/appfactory-project-automation/commit/c71ac965a2c2b21590077486f11bf30a4c98b07f))
* **aws:** generalize proven SSM/CloudFormation workflow to all tenant repos; gate secrets before EC2 spending ([fbae2b2](https://github.com/EagleFox31/appfactory-project-automation/commit/fbae2b2ccd4f253e5b5ef7fd1839703bff3d7a3d))
* **aws:** narrow GitOps approval proof for only bounded Précis IAM reader ([7171e1e](https://github.com/EagleFox31/appfactory-project-automation/commit/7171e1e48339c4b47924b19252e9ba0e255cc253))
* **aws:** one-command guarded CloudShell bootstrap with dry-run default ([cececa3](https://github.com/EagleFox31/appfactory-project-automation/commit/cececa38f88bab15e59de0d75c2ae3f22cfa6307))
* **aws:** promote Atelier OIDC/CloudFormation/SSM Compose deployment into reusable AppFactory workflow ([a464930](https://github.com/EagleFox31/appfactory-project-automation/commit/a464930e713c1691e0c9fef6595b410493d0b961))
* **aws:** read-only delegated staging provisioner capability audit ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([3ca1fd2](https://github.com/EagleFox31/appfactory-project-automation/commit/3ca1fd27ffbbab53de8f91b755d0c2eef94656f3))
* **aws:** read-only live CloudFormation status of isolated Précis IAM stack ([8e233e4](https://github.com/EagleFox31/appfactory-project-automation/commit/8e233e45ab794ed3ca31fdc27e4ec948e266ba99))
* **aws:** replace repeated console IAM setup with guarded one-time CloudShell bootstrap ([0e53af6](https://github.com/EagleFox31/appfactory-project-automation/commit/0e53af6761eca083348efe79a6e8c0c0d06dce75))
* **aws:** reusable cost ceiling and Free Plan reserve gate for disposable staging ([e524674](https://github.com/EagleFox31/appfactory-project-automation/commit/e524674cb2b141f3aba81506a6cc756dee2854a8))
* **aws:** reusable isolated EC2/SSM staging host CloudFormation blueprint (plan-only) ([c80b939](https://github.com/EagleFox31/appfactory-project-automation/commit/c80b939e0f837848add8b67391475f4c89287db2))
* **aws:** reusable isolated Précis Compose staging host IaC blueprint (plan only, RAIDER [#120](https://github.com/EagleFox31/appfactory-project-automation/issues/120)) ([222f824](https://github.com/EagleFox31/appfactory-project-automation/commit/222f8248e49f086e6e2f225bf64019dc674e8761))
* **aws:** trigger approved Précis IAM-only IaC through GitHub, no console ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([2fb6c48](https://github.com/EagleFox31/appfactory-project-automation/commit/2fb6c488a528b57337977f19c786c63ea39e36db))
* **aws:** validate separate delegated staging roles using readonly IAM simulation ([f48f62a](https://github.com/EagleFox31/appfactory-project-automation/commit/f48f62a4640138331ecd8e82fd29a7fda6180e6c))
* **aws:** verify live STS and Free Tier read-only snapshots ([2cc1667](https://github.com/EagleFox31/appfactory-project-automation/commit/2cc166770a023e67a26bd0cc8711421d0a4d2488))
* **ci:** publish CI-bound immutable GHCR digest manifest ([#82](https://github.com/EagleFox31/appfactory-project-automation/issues/82)) ([2d9c7c4](https://github.com/EagleFox31/appfactory-project-automation/commit/2d9c7c49bdb7826920fccf3614d9b8d21d8e4af5))
* **ci:** validated reusable GHCR container build (phase 1) ([#78](https://github.com/EagleFox31/appfactory-project-automation/issues/78)) ([8c35170](https://github.com/EagleFox31/appfactory-project-automation/commit/8c3517020badf20d4c915c9c2d365cae1b4f45f7))
* **ci:** verify GitHub-run provenance for immutable image release ([#83](https://github.com/EagleFox31/appfactory-project-automation/issues/83)) ([efa541a](https://github.com/EagleFox31/appfactory-project-automation/commit/efa541a361090397b3c4c1b1ddbd6dc3ccd29d0a))
* **deploy:** enforce digest/backup/rollback rollout safety contract ([#84](https://github.com/EagleFox31/appfactory-project-automation/issues/84)) ([6934c6c](https://github.com/EagleFox31/appfactory-project-automation/commit/6934c6c50922ae5abfe4b090fb765275c512b640))
* **project:** dogfood Projects automation ([#76](https://github.com/EagleFox31/appfactory-project-automation/issues/76)) ([00213bd](https://github.com/EagleFox31/appfactory-project-automation/commit/00213bd56e34c561e46845667f8063f394524ac4))
* **RAIDER:** reuse Atelier AWS OIDC, CloudFormation and SSM Compose deployment for Précis ([#120](https://github.com/EagleFox31/appfactory-project-automation/issues/120)) ([8bf7f4a](https://github.com/EagleFox31/appfactory-project-automation/commit/8bf7f4a5aa638259525ac226e5f4e44b92550c82))
* **ssm:** bound per-instance Run Command polling without dispatch ([5c4b2ac](https://github.com/EagleFox31/appfactory-project-automation/commit/5c4b2acfae2bb6e6e33df89290c83e32f59d22bb))
* **ssm:** bounded per-instance gateway polling ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([74d3cf1](https://github.com/EagleFox31/appfactory-project-automation/commit/74d3cf1dee8968f2adb6e349e0d61449f6d557cf))
* **ssm:** fail-closed command receipt and invocation result checks ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([30703f5](https://github.com/EagleFox31/appfactory-project-automation/commit/30703f5eb3269a15cbd71d77510ec282f0629a74))
* **ssm:** fail-closed invocation receipt and result validation ([33a2690](https://github.com/EagleFox31/appfactory-project-automation/commit/33a26905fdc28d6e234a371d8bec6cd333e56907))
* **ssm:** host-local digest Compose rollback executor with backup proof ([#85](https://github.com/EagleFox31/appfactory-project-automation/issues/85)) ([6292402](https://github.com/EagleFox31/appfactory-project-automation/commit/6292402679f50f5c7e9c8c65e01efc4cb032de58))
* **ssm:** read-only project-isolated AWS target preflight ([#81](https://github.com/EagleFox31/appfactory-project-automation/issues/81)) ([510856c](https://github.com/EagleFox31/appfactory-project-automation/commit/510856cc1c290ddf8fd03ec2437ce647c96affb4))
* **ssm:** stage-gated send command orchestration ([d1a6521](https://github.com/EagleFox31/appfactory-project-automation/commit/d1a6521daeb666e8fa99f612263c75981e33d474))
* **ssm:** staging-only gated dispatch coordinator ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([bb3a7d5](https://github.com/EagleFox31/appfactory-project-automation/commit/bb3a7d54c8f5f9141c0c82b13fec1fb44fb65169))
* **ssm:** verified digest-only host payload plan ([#86](https://github.com/EagleFox31/appfactory-project-automation/issues/86)) ([866b369](https://github.com/EagleFox31/appfactory-project-automation/commit/866b3696ba77c3bcada1694b0845e9214e041f0b))
* **visual-qa:** reusable rendered frontend gates ([#113](https://github.com/EagleFox31/appfactory-project-automation/issues/113)) ([151add8](https://github.com/EagleFox31/appfactory-project-automation/commit/151add8b850fb8a81f5ecceaa4fde1505fd9c1a2))


### Bug Fixes

* **aws:** bind Précis deploy role to existing central GitHub OIDC provider ([#131](https://github.com/EagleFox31/appfactory-project-automation/issues/131)) ([100d16e](https://github.com/EagleFox31/appfactory-project-automation/commit/100d16ebd0c8adcec1d52eeabb7383e30b9ec061))
* **aws:** bind Précis IAM change-set guard to actual Stack.RoleARN ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([faa7d64](https://github.com/EagleFox31/appfactory-project-automation/commit/faa7d6417cadc7f2404df636cfbdb11a209e1fe1))
* **aws:** export same-step changeset and safely resume exact reviewed pending IAM stack ([04b10d1](https://github.com/EagleFox31/appfactory-project-automation/commit/04b10d17f893b055a8a032dbd778e2b61da2e4ef))
* **aws:** give staging host only its own exact SSM SecureString parameter read ([a784175](https://github.com/EagleFox31/appfactory-project-automation/commit/a784175c50906b9454366f2938c570cdc96ac4d7))
* **aws:** pin repaired, CI-validated Précis IAM template for live validation ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([3a64355](https://github.com/EagleFox31/appfactory-project-automation/commit/3a643554129d1749af485a499b1308f4e8a887b2))
* **aws:** pin the strictly validated Précis reader IAM template commit ([7c49e2a](https://github.com/EagleFox31/appfactory-project-automation/commit/7c49e2aba5b5c66364e3bbf77667356111658e68))
* **aws:** plan only documented Free Tier eligible EC2 sizes and new bounded 7-day forecast ([446eb8e](https://github.com/EagleFox31/appfactory-project-automation/commit/446eb8ea9fc31e5c8f0e6d214e49313ac68ba42a))
* **aws:** remove duplicated CloudFormation sections; restore valid mandatory TTL parameters ([c3d1df6](https://github.com/EagleFox31/appfactory-project-automation/commit/c3d1df601d56b2fd4b216fd98bf8357e063b558f))
* **aws:** repair duplicated staging TTL IaC and add strict YAML CI gate ([#120](https://github.com/EagleFox31/appfactory-project-automation/issues/120)) ([dfa2935](https://github.com/EagleFox31/appfactory-project-automation/commit/dfa2935d73b7df48a0c4800131f02b67fa3d7492))
* **aws:** restrict staging EC2 to eligible Free Tier types; condition T3 credit setting ([46426f2](https://github.com/EagleFox31/appfactory-project-automation/commit/46426f2092a87576d6e961bebe396d62765b2a50))
* **aws:** resume user-approved Précis IAM change set safely after partial workflow failure ([#75](https://github.com/EagleFox31/appfactory-project-automation/issues/75)) ([18f8a94](https://github.com/EagleFox31/appfactory-project-automation/commit/18f8a9417faf6a503bb4da2e8a4779c12e72695c))
* **aws:** reuse existing central OIDC provider directly; eliminate missing standalone parameter ([5925f03](https://github.com/EagleFox31/appfactory-project-automation/commit/5925f03b6b9661d05fd0ecdb744e39a6a5704fb4))
* **aws:** upgrade EXISTING AppFactory central IAM stack for Précis deployment ([#120](https://github.com/EagleFox31/appfactory-project-automation/issues/120)) ([d5bebf0](https://github.com/EagleFox31/appfactory-project-automation/commit/d5bebf00a590325205e8b122ea0222dfcaa89304))
* **aws:** verify real stack-bound CloudFormation service role when change-set field is null ([d32b6e5](https://github.com/EagleFox31/appfactory-project-automation/commit/d32b6e5ce53c07236fdfd1f84066b2e36f6bdb48))
* **ci:** isolate read-only container plan from GHCR publishing ([#79](https://github.com/EagleFox31/appfactory-project-automation/issues/79)) ([fb04757](https://github.com/EagleFox31/appfactory-project-automation/commit/fb04757613e9514d2fd39147f5d4f7bae0dfd3d4))
* **ci:** remove empty environment mapping from SHA-pinned workflow ([d9ca469](https://github.com/EagleFox31/appfactory-project-automation/commit/d9ca469771470763a5de5f886c80b442ace428b4))
* **iam:** normalize CloudFormation ASCII policy and output identifiers ([b0ba1b5](https://github.com/EagleFox31/appfactory-project-automation/commit/b0ba1b57dc7e3f4d2dc2eace70b112704ffb6025))
* **precis:** select x86 8-GiB AWS Free Tier eligible host for LibreOffice ([69e096b](https://github.com/EagleFox31/appfactory-project-automation/commit/69e096bc4b1771745cdda6cd43dfc65fb57afeb2))
* **RAIDER:** select actual 2026 AWS Free Tier eligible EC2 instance for Précis ([b648f00](https://github.com/EagleFox31/appfactory-project-automation/commit/b648f004ded3fe563138b61003b93e8f13bb8899))
* **ssm:** attest host Compose and backup hook Git contents ([#87](https://github.com/EagleFox31/appfactory-project-automation/issues/87)) ([b6dfea8](https://github.com/EagleFox31/appfactory-project-automation/commit/b6dfea872f6ef944d493325499d597f22cca668f))
* **test:** model AWS invocation response using official field casing ([5d6779d](https://github.com/EagleFox31/appfactory-project-automation/commit/5d6779df1eed615d108388353f5290aab8f288d9))
* **visual-qa:** actionable axe target and contrast diagnostics ([#125](https://github.com/EagleFox31/appfactory-project-automation/issues/125)) ([01baea2](https://github.com/EagleFox31/appfactory-project-automation/commit/01baea249aa271bab751a819aad255d9a101ad43))


### Documentation

* **aws:** align AppFactory auto preflight with Atelier's OIDC GitHub Actions pattern ([54e8290](https://github.com/EagleFox31/appfactory-project-automation/commit/54e829028c3fd6c7a3a2590034ea4fb4255915d8))
* **aws:** dedicated OIDC readonly role and Free Plan no-spend conditions ([538a0b1](https://github.com/EagleFox31/appfactory-project-automation/commit/538a0b184fb71fe7c3c6d1ff8240042aa2296747))
* **aws:** establish one-time trust boundary and reusable IaC bootstrap ([7306c3b](https://github.com/EagleFox31/appfactory-project-automation/commit/7306c3b6ff81e3eaccfdf6c47d0da1235d5bd1a3))
* **aws:** exact once-only central IAM authorization and automated per-project apply flow ([3ca2fe8](https://github.com/EagleFox31/appfactory-project-automation/commit/3ca2fe88445350f703f1d5b095267e428f9b005d))
* **aws:** one-owner-approval-to-GitOps IAM workflow, no extra console steps ([53aee15](https://github.com/EagleFox31/appfactory-project-automation/commit/53aee15e2b36d497779a2e51f100d6b7bfa5f3fd))
* **aws:** read-only onboarding run no longer requests consumer SHA ([fffbf5a](https://github.com/EagleFox31/appfactory-project-automation/commit/fffbf5a764019e22b7c43cfa8d4734fdce62b0cd))
* **ci:** report true 8-GiB Free Tier host size in automatic budget summary ([607334b](https://github.com/EagleFox31/appfactory-project-automation/commit/607334b009351888d17ecddcce592166a96f8fbe))
* define reusable WOW Frontend capability ([#92](https://github.com/EagleFox31/appfactory-project-automation/issues/92)) ([52a91bc](https://github.com/EagleFox31/appfactory-project-automation/commit/52a91bcfa80c7e357ac367336fcbfd585f9c3807))
* **RAIDER:** audited complete AWS Précis staging architecture, cost gates and Proof of Done ([bd4bfe2](https://github.com/EagleFox31/appfactory-project-automation/commit/bd4bfe2f3f8265417f4e1fcf2289c07d174be2f1))
* **RAIDER:** capture malformed TTL YAML incident and mandatory strict PR parser ([4618f1e](https://github.com/EagleFox31/appfactory-project-automation/commit/4618f1e46a91de988656bbbdd92895e2f734c659))
* **RAIDER:** map proven Atelier deployment into reusable AppFactory with exact blockers ([7f62aa9](https://github.com/EagleFox31/appfactory-project-automation/commit/7f62aa9b817a900fd6dad12b561326737d3f990b))
* **RAIDER:** prevent malformed IaC YAML after AWS staging validation failure ([#120](https://github.com/EagleFox31/appfactory-project-automation/issues/120)) ([cfd4c40](https://github.com/EagleFox31/appfactory-project-automation/commit/cfd4c40e04818ab613c19d63b8a69b94d26200ec))
* **RAIDER:** quantitative staging credit budget, time-to-live and public access constraints ([d98e2e9](https://github.com/EagleFox31/appfactory-project-automation/commit/d98e2e94ce6bfb92d0081de997c6949ce4b65dc1))
* **RAIDER:** record CloudFormation partial-state and GITHUB_ENV same-step failure memory ([4acc370](https://github.com/EagleFox31/appfactory-project-automation/commit/4acc370a43243e524262f2a862542ccec46d7139))
* **RAIDER:** record observed CloudFormation change-set null role and authoritative stack role ([ae3d15b](https://github.com/EagleFox31/appfactory-project-automation/commit/ae3d15bacc95ef25636029604e126c346bc16532))
* **RAIDER:** switch Précis host sizing and credit forecast to Free Tier eligible m7i-flex.large ([4342e08](https://github.com/EagleFox31/appfactory-project-automation/commit/4342e084b8a4eb59a2c26584c69a5bc2501c291e))

## [1.4.0](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.3.0...v1.4.0) (2026-10-04)


### Features

* add reusable impact-aware CI ([#70](https://github.com/EagleFox31/appfactory-project-automation/issues/70)) ([20c6b99](https://github.com/EagleFox31/appfactory-project-automation/commit/20c6b99e8dd063a1cac72a5fc2cfa38829a1b899))
* add reusable Tauri desktop release automation ([#61](https://github.com/EagleFox31/appfactory-project-automation/issues/61)) ([7b7bcbb](https://github.com/EagleFox31/appfactory-project-automation/commit/7b7bcbb3e6eaa9fa5ba48e0064c43f36a4207252))
* allow exact consumer checkout ref in impact analysis ([#73](https://github.com/EagleFox31/appfactory-project-automation/issues/73)) ([9e35169](https://github.com/EagleFox31/appfactory-project-automation/commit/9e351696d594c99059563f93140b492814f00679))
* **broker:** allow promoted Project runtime during migration ([0817c90](https://github.com/EagleFox31/appfactory-project-automation/commit/0817c90c6f9271c66532d8e37449dd24849ad92e))
* **broker:** move production deployment to Cloudflare Workers Builds ([b4d0c22](https://github.com/EagleFox31/appfactory-project-automation/commit/b4d0c222eeb450560fd72a46c89b2bcb81798441))
* **broker:** support private Trigenys repositories without PATs ([14d5116](https://github.com/EagleFox31/appfactory-project-automation/commit/14d51168311c25f41d89df370c5e2ad2d5f42e83))
* **projects:** make zero-PAT the default Project workflow ([da6a1b4](https://github.com/EagleFox31/appfactory-project-automation/commit/da6a1b4a557e33d7e7829c11e14dab8ca409df4a))


### Bug Fixes

* **broker:** authorize durable project runtime ([e32d313](https://github.com/EagleFox31/appfactory-project-automation/commit/e32d313793affcf15ec78347c8188d98f2f32b4f))
* **broker:** preserve existing Cloudflare Worker secrets by default ([24a70bd](https://github.com/EagleFox31/appfactory-project-automation/commit/24a70bd15910a53f3fa54182ba97b363144cadaf))
* capture MSI exit codes reliably ([#67](https://github.com/EagleFox31/appfactory-project-automation/issues/67)) ([2856fc4](https://github.com/EagleFox31/appfactory-project-automation/commit/2856fc410ecd4b50b7ec5a58ac32d692dcd47170))
* make Tauri prereleases safe for Windows MSI ([#63](https://github.com/EagleFox31/appfactory-project-automation/issues/63)) ([0e7028f](https://github.com/EagleFox31/appfactory-project-automation/commit/0e7028fb721114b2281b1e1041ac8ac66367748a))
* **projects:** isolate concurrency by work item ([8d3be4c](https://github.com/EagleFox31/appfactory-project-automation/commit/8d3be4c72740d22992bb449ff157cc7c818cf9d7))
* serialize Project bootstrap before item synchronization ([#74](https://github.com/EagleFox31/appfactory-project-automation/issues/74)) ([2d890bc](https://github.com/EagleFox31/appfactory-project-automation/commit/2d890bc4b0c701b383d50a0255112ba5e4f6a356))
* support Tauri consumers without an npm lockfile ([#65](https://github.com/EagleFox31/appfactory-project-automation/issues/65)) ([6a38927](https://github.com/EagleFox31/appfactory-project-automation/commit/6a389276ffb89a94266029ec37d90e7b167cd95d))


### Documentation

* **broker:** record native Cloudflare build trigger ([57f1305](https://github.com/EagleFox31/appfactory-project-automation/commit/57f130581c5a10e5cc8f884df073641bc7b7e4f7))
* **raider:** record dropped-event concurrency failure ([b1deb7b](https://github.com/EagleFox31/appfactory-project-automation/commit/b1deb7b1069739879d7a4acb9cd3521bca835049))

## [1.3.0](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.2.3...v1.3.0) (2026-09-22)


### Features

* add governance credential preflight ([3b44c1a](https://github.com/EagleFox31/appfactory-project-automation/commit/3b44c1a9aa9fc90b9291fb2a8aa45e91bda2fa53))
* add governance credential preflight ([e6604bd](https://github.com/EagleFox31/appfactory-project-automation/commit/e6604bdb58ebe616f5b11cf9f2db4167c3ddb3f9))
* add governance plan and apply modes ([5ef9627](https://github.com/EagleFox31/appfactory-project-automation/commit/5ef9627a1f6dba36e649ad2a54a342141f105a1d))
* add governance plan and apply modes ([55b46e9](https://github.com/EagleFox31/appfactory-project-automation/commit/55b46e9c2bf24cad7cf3ba3a5cfcbd8fa1a538eb))
* add opt-in continuous governance example ([1adba9c](https://github.com/EagleFox31/appfactory-project-automation/commit/1adba9c791306cb1e5f3d5fc88b20072264db04b))
* add opt-in continuous governance reconciliation ([1a5e2b3](https://github.com/EagleFox31/appfactory-project-automation/commit/1a5e2b3e996cff77c631235c6dfd42ca710eecb1))
* add reusable governance reconciliation workflow ([681e12f](https://github.com/EagleFox31/appfactory-project-automation/commit/681e12facb92514cf44c29dea4a46fd8f0286489))
* define RAIDER governance policy contract ([6b89f35](https://github.com/EagleFox31/appfactory-project-automation/commit/6b89f353017751ec90fb427c895a679033770ca3))
* define RAIDER governance policy contract ([5ac6f14](https://github.com/EagleFox31/appfactory-project-automation/commit/5ac6f14b1c7c7e18958bfa52aec7436b358a4655))
* **governance:** add zero-PAT GitHub App authentication ([ef38004](https://github.com/EagleFox31/appfactory-project-automation/commit/ef38004e78a052017bac390d817ae189ab49fab4))
* **governance:** support GitHub App authentication ([216b562](https://github.com/EagleFox31/appfactory-project-automation/commit/216b5627a1cc29fdbb67b8116c8610d428f23087))
* **projects:** add brokered GitHub App user authentication ([09f3337](https://github.com/EagleFox31/appfactory-project-automation/commit/09f3337b57e932ffccdd700a421b9d4b375d167e))
* **projects:** add brokered GitHub App user authentication ([7200a8a](https://github.com/EagleFox31/appfactory-project-automation/commit/7200a8ab2bb1467871140f159b1734b07e4f2d00))
* **projects:** add hosted zero-PAT token broker ([7ff2980](https://github.com/EagleFox31/appfactory-project-automation/commit/7ff298087308d7ddcc8e507d8eb9adb56c2e2158))
* **projects:** add hosted zero-PAT token broker ([ccaef83](https://github.com/EagleFox31/appfactory-project-automation/commit/ccaef83d24e36ee9d3716d0bc024f97790ee7ae2))
* **projects:** support OAuth App broker for personal Projects ([#47](https://github.com/EagleFox31/appfactory-project-automation/issues/47)) ([d023d10](https://github.com/EagleFox31/appfactory-project-automation/commit/d023d1098385dd914b2de015b96f010fb6b31060))
* reconcile repository rulesets idempotently ([ff3b7ea](https://github.com/EagleFox31/appfactory-project-automation/commit/ff3b7ea6249882c8a46706df13db04c9cd9ccd94))
* reconcile repository rulesets idempotently ([634ef83](https://github.com/EagleFox31/appfactory-project-automation/commit/634ef83e4a7e52f3595817563e2184cc27cb5b7c))
* support brownfield governance adoption ([a3a0fbf](https://github.com/EagleFox31/appfactory-project-automation/commit/a3a0fbf8bef5b1fe12361c5e298355b3dd9a1879))
* support brownfield governance adoption ([c943665](https://github.com/EagleFox31/appfactory-project-automation/commit/c94366526e77a2490a52e92301ae0fe8f4d3abf8))
* support standalone .NET executable release assets ([8267e4e](https://github.com/EagleFox31/appfactory-project-automation/commit/8267e4eb58d52af2b8cb23d59e570121d23359b4))


### Bug Fixes

* **governance:** accept verified GitHub App admin capability ([7aadab7](https://github.com/EagleFox31/appfactory-project-automation/commit/7aadab7eb24eb111e3fa324dd073c51d7ef763fa))
* **governance:** accept verified GitHub App admin capability ([eb0b153](https://github.com/EagleFox31/appfactory-project-automation/commit/eb0b153f404f08be91a97a029e4c32d127fb8d7f))
* read hyphenated action inputs correctly ([ff4daee](https://github.com/EagleFox31/appfactory-project-automation/commit/ff4daeeac6ce25121a0f0373234f5c6a9055afb6))
* read hyphenated Action inputs correctly ([b163134](https://github.com/EagleFox31/appfactory-project-automation/commit/b1631349800f85a29dc2948391745e2fc67c1eb6))
* support pre-release governance runtime pin ([35a73c3](https://github.com/EagleFox31/appfactory-project-automation/commit/35a73c3f39c0388ba3f1ea1980db6d4b0dc939ea))
* support pre-release governance runtime pin ([c7dee92](https://github.com/EagleFox31/appfactory-project-automation/commit/c7dee921f16bb2517af72dbfd49e01544ec3c820))


### Documentation

* add beginner governance onboarding ([eac14d9](https://github.com/EagleFox31/appfactory-project-automation/commit/eac14d9e6f1a4cc15959949eb6c234912cfa0c0a))
* add beginner governance onboarding ([cb59733](https://github.com/EagleFox31/appfactory-project-automation/commit/cb59733576ab973237935a95d36ce081c34723d3))
* add bug report issue form ([630090f](https://github.com/EagleFox31/appfactory-project-automation/commit/630090fc6b9ebb54b0316b2855b02b30db26bf9b))
* add contribution guide ([acdfcd6](https://github.com/EagleFox31/appfactory-project-automation/commit/acdfcd627c5dc7b4c80f29a4e22452dd0f825b92))
* add feature request issue form ([cf5d3bd](https://github.com/EagleFox31/appfactory-project-automation/commit/cf5d3bd135f91260ae9790c4cd1210c9667574c8))
* add MIT license ([9469ca6](https://github.com/EagleFox31/appfactory-project-automation/commit/9469ca65f411e145262e9ec1b4e1c3002fb87101))
* add security policy ([4b2fc72](https://github.com/EagleFox31/appfactory-project-automation/commit/4b2fc72ebdfd302524d2a244ee8e2b8f1ba8584d))
* clarify project and release automation ([bdc5bb7](https://github.com/EagleFox31/appfactory-project-automation/commit/bdc5bb74dd8f4e203c4c31d839f39382431b2649))
* configure issue templates ([0aa0d4d](https://github.com/EagleFox31/appfactory-project-automation/commit/0aa0d4dd22c78c4d493ab9deef6f51fbee5cf517))
* document continuous governance reconciliation ([775399a](https://github.com/EagleFox31/appfactory-project-automation/commit/775399ae50db620bae04ea383a790dfe17642d5d))
* document continuous governance reconciliation ([21cce14](https://github.com/EagleFox31/appfactory-project-automation/commit/21cce141247156b8282a26bccf0a1c1ff7c2ae34))
* document continuous governance reconciliation ([7d005d0](https://github.com/EagleFox31/appfactory-project-automation/commit/7d005d034ba2adad11b48e6a6357de8373350dd9))
* expose continuous governance option ([32aa0bd](https://github.com/EagleFox31/appfactory-project-automation/commit/32aa0bda293f1eb45284eca007ea7307a02864ff))
* record AgenStart governance V1 validation ([cf401c0](https://github.com/EagleFox31/appfactory-project-automation/commit/cf401c045390f59d1fcf836c1b5240ccd05413a6))
* record AgenStart governance V1 validation ([626962b](https://github.com/EagleFox31/appfactory-project-automation/commit/626962ba832125d8086b2d692359c06510fc081c))

## [1.2.3](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.2.2...v1.2.3) (2026-09-16)


### Bug Fixes

* improve Marketplace metadata ([aca0952](https://github.com/EagleFox31/appfactory-project-automation/commit/aca0952b079abd1cd3c64c393560c524532d27c7))

## [1.2.2](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.2.1...v1.2.2) (2026-09-04)


### Bug Fixes

* defer self-release repair until Release Please fails ([6e1d31d](https://github.com/EagleFox31/appfactory-project-automation/commit/6e1d31d1a1fcfb04dfdc4ecaecad6a6b743bb743))
* run release repair only after Release Please fails ([4349548](https://github.com/EagleFox31/appfactory-project-automation/commit/4349548ddc1717247902824095095592c74113f1))

## [1.2.1](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.2.0...v1.2.1) (2026-09-04)


### Bug Fixes

* align reusable release with Release Please v4 ([3028d22](https://github.com/EagleFox31/appfactory-project-automation/commit/3028d22b493a3fe140de2c55aced9ca6a8a8f85c))
* remove deprecated tag-prefix wiring ([358a34a](https://github.com/EagleFox31/appfactory-project-automation/commit/358a34a54cc7a62f0814b143801fe67c8712c14f))
* stop forwarding removed Release Please v4 input ([239c949](https://github.com/EagleFox31/appfactory-project-automation/commit/239c9494f8ae45db58afd3674e93e5c108bdacd6))

## [1.2.0](https://github.com/EagleFox31/appfactory-project-automation/compare/v1.1.0...v1.2.0) (2026-09-04)


### Features

* add reusable dotnet desktop release workflow ([5b80f91](https://github.com/EagleFox31/appfactory-project-automation/commit/5b80f9189ead1afe60b4ee6813bd830ba78e4742))
* add reusable product release automation ([8d47808](https://github.com/EagleFox31/appfactory-project-automation/commit/8d47808ed3a0f4f1c89ba8279fff9823462cb2a0))
* add reusable semantic release workflow ([a163d84](https://github.com/EagleFox31/appfactory-project-automation/commit/a163d843693ed534879bafdcd76924e9df358962))


### Bug Fixes

* use safe release output identifiers ([e96a031](https://github.com/EagleFox31/appfactory-project-automation/commit/e96a0311af198ddc575587caa88f6b030f3e74e5))
* use safe reusable workflow output identifiers ([830db41](https://github.com/EagleFox31/appfactory-project-automation/commit/830db414c7faea91e8674feba6604e391bbd684d))


### Documentation

* add dotnet desktop release example ([eaf45bc](https://github.com/EagleFox31/appfactory-project-automation/commit/eaf45bcbc408fe17584c952a00e8e207352df717))
* add generic product release example ([89a3a1b](https://github.com/EagleFox31/appfactory-project-automation/commit/89a3a1b864f153788615c55f8c69786584fb1eec))
* document reusable product release automation ([454e211](https://github.com/EagleFox31/appfactory-project-automation/commit/454e211c391e46f83d9314eab09ac69cfb740f50))
