import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { t, type MessageKey } from '@athanor/i18n';
import { PASSWORD_REQUIREMENTS, passwordSchema, unmetPasswordRequirements } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EyeGlyph, EyeOffGlyph } from '@/components/glyphs';
import { Input } from '@/components/Input';
import { authErrorKey, oauthErrorKey } from '@/lib/auth-errors';
import { useDraftLocale } from '@/hooks/use-draft-locale';
import { LEGAL_PRIVACY_URL, LEGAL_TERMS_URL } from '@/lib/links';
import { AUTH_REDIRECT_URL, signInWithProvider } from '@/lib/oauth';
import { clearPendingReferral, getPendingReferral } from '@/lib/referral';
import { supabase } from '@/lib/supabase';
import { SectionLabel } from '@/components/SectionLabel';
import { KeyboardAvoiding } from '@/components/KeyboardAvoiding';
import { useAnnounceOnMount } from '@/lib/a11y';
import { Screen } from '@/components/Screen';

// Well-formed check (UX gate only) — the real validity verdict is Supabase's.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Apple sign-in needs the Supabase Apple provider, which requires a paid Apple
// Developer account (Services ID + key) — not yet configured. Flip to true once it
// is; the code path is provider-agnostic and needs no other change.
const APPLE_ENABLED = false;

// Google is configured on the staging project: provider on, client ID + secret set. Staging's
// allow-list carries the standalone `athanor://` forms and the exp.direct ones, so the device
// walk has to run `pnpm exec expo start --tunnel`. It is NOT every form this app can emit: a
// LAN start can never complete the round trip, because GoTrue substitutes Site URL for any
// private-LAN target whether or not it is listed (#73), and the web build emits
// `http://localhost:8081/auth-callback`, which is not on the list either. Both fail silently.
// Google is enabled on BOTH hosted projects since #77 — production included, so this button is
// live for real members today. The flag stays environment-blind: pointed at a project whose
// provider is off, it still renders and the round trip can only come back an error.
const GOOGLE_ENABLED = true;

const ANY_OAUTH = APPLE_ENABLED || GOOGLE_ENABLED;

const PROVIDER_LABEL: Record<'apple' | 'google', string> = { apple: 'Apple', google: 'Google' };

export default function WelcomeScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const login = mode === 'login'; // existing-user sign-in vs new-account creation
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // idle → submitting → (sent | gone). `sent` is only reachable with email confirmations ON:
  // signUp comes back without a session, so this screen owns the outcome instead of handing
  // it to AuthGuard. Replaces the old `submitting` + `notice` pair, which could not express
  // "the request finished and the screen is now the confirmation" (#618).
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'sent'>('idle');
  // Marco could not see what he was typing on the device walk. Revealing also turns the
  // field non-secure, which is the only remedy there is for #615's first-ranked hypothesis
  // (UIKit clears a SECURE field when editing resumes) — so this doubles as its discriminator.
  const [revealed, setRevealed] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<null | 'apple' | 'google'>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const submitting = phase === 'submitting';
  // Draft-aware (#158): the funnel routes here right after a language choice.
  const locale = useDraftLocale();

  const copy = (suffix: 'eyebrow' | 'display' | 'sub') =>
    t(`${login ? 'auth.login' : 'auth.signup'}.${suffix}` as MessageKey, locale);

  // On success the session triggers onAuthStateChange → auth-context hydrates the
  // profile + flushes the onboarding draft → AuthGuard routes to Home. No nav here.
  const submit = async () => {
    setPhase('submitting');
    setError(null);
    if (login) {
      // A code stashed on this device (e.g. from a link opened before the user chose to
      // sign into an existing, unrelated account) must never attach to that account.
      // Before the call, not after it: signInWithPassword sets the session, and the
      // boot-time consumer (auth-context) spends the stash off exactly that. Clearing
      // afterwards races it. The cost is that a mistyped password spends the stash too —
      // the same trade the OAuth branch makes, and the screen is the reason it is the right
      // one: the member has said they already have an account.
      await clearPendingReferral();
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        if (__DEV__) console.warn('[auth] signIn', err.status, err.code, err.message);
        setPhase('idle');
        setError(t(authErrorKey(err), locale));
        return;
      }
      // Deliberately NOT back to idle (#618): the call returning is not the outcome. The
      // session hop — onAuthStateChange → profile hydrate → AuthGuard — is still running,
      // and dropping the spinner here left the screen silent for all of it. Whichever way
      // that hop ends replaces this screen: the app routes, or `app/_layout.tsx` swaps in
      // ProfileErrorScreen. Neither leaves the spinner up.
      //
      // The trade, named because it is one: if that hop hung — resolving neither a profile
      // nor an error — the spinner would have no escape. Weighed against the behaviour it
      // replaces, which re-enabled the CTA over an already-set session and so invited a
      // second sign-in at it. A stuck spinner would be auth-context's bug to fix, and no
      // timeout invented here could tell a hung hydrate from a slow one.
      return;
    }
    // `display_name` goes into auth.users.user_metadata, and handle_new_user copies it
    // onto profiles.display_name from there (20260811072211) — normalised, so a long or
    // blank value can never raise inside that trigger and abort the signup. Editing the
    // name after signup needs the client surface in #76; this is the write path only.
    // Referral attribution rides on this metadata for the email paths only: handle_new_user
    // (born confirmed) and handle_user_confirmed both read `referral_code` out of
    // raw_user_meta_data. An OAuth signup carries none, so it is redeemed post-hoc instead —
    // auth-context spends the stash on the first authenticated boot (#78).
    // The disabled button is a hint, not a guarantee: a password manager can fill
    // the field and fire submit in the same frame. Parse at the boundary too.
    if (!passwordSchema.safeParse(password).success) {
      setPhase('idle');
      setError(t('auth.error.weakPassword', locale));
      return;
    }
    const referral = await getPendingReferral();
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Without this the confirmation mail's link falls back to the project's
        // Site URL — the marketing site — so someone confirming from their phone
        // lands in a browser instead of back in the app. Shares the OAuth flow's
        // allow-list entry rather than needing its own, but that entry must exist
        // on the HOSTED project too (Auth → URL Configuration): GoTrue answers a
        // missing one by silently substituting Site URL. Lands on
        // src/app/auth-callback.tsx, which exchanges the PKCE code.
        emailRedirectTo: AUTH_REDIRECT_URL,
        data: {
          display_name: name.trim(),
          ...(referral ? { referral_code: referral } : {}),
        },
      },
    });
    if (err) {
      if (__DEV__) console.warn('[auth] signUp', err.status, err.code, err.message);
      setPhase('idle');
      setError(t(authErrorKey(err), locale));
      return;
    }
    void clearPendingReferral();
    // With confirmations ON, a signup for an address that already exists comes
    // back 200 with an obfuscated user rather than 422 — an empty `identities`
    // is the only tell. Without this the user is sent to wait for a mail that
    // is never sent.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setPhase('idle');
      setError(t('auth.error.emailTaken', locale));
      return;
    }
    // Confirmations OFF → session is set → AuthGuard routes, and the spinner rides that hop
    // for the same reason the sign-in branch does. Confirmations ON → no session, so the
    // screen becomes the confirmation. Which of the two a build gets is per-project and they
    // differ: STAGING has confirmations on, PRODUCTION runs mailer_autoconfirm = true and
    // sends no confirmation mail at all (docs/PRODUCTION-READINESS.md §P1.6, issue #70).
    // Both branches are live somewhere, so neither is dead code.
    if (!data.session) setPhase('sent');
  };

  // OAuth: success routes via onAuthStateChange; cancellation is silent.
  const handleOAuth = async (provider: 'apple' | 'google') => {
    setError(null);
    // Busy first: everything below this line awaits, and `disabled` is what stops a second tap
    // opening a second round trip.
    setOauthBusy(provider);
    // Same move as the email sign-in branch above: on the sign-in screen the member has said
    // they already have an account, so a stashed code must not follow them into it. That is
    // intent, not proof — OAuth cannot tell a signup from a sign-in at all, and an existing
    // member who arrives on the DEFAULT screen from an invite link is in signup mode and keeps
    // the stash. What bounds that one is the RPC's account-age gate, not this line.
    // Cleared BEFORE the round trip: exchangeCodeForSession fires onAuthStateChange while that
    // call is still awaiting, so auth-context has already read the stash by the time it returns.
    if (login) await clearPendingReferral();
    const outcome = await signInWithProvider(provider);
    setOauthBusy(null);
    if (outcome.status === 'error') {
      if (__DEV__) console.warn('[auth] oauth', provider, outcome.message);
      setError(t(oauthErrorKey(outcome.message), locale, { provider: PROVIDER_LABEL[provider] }));
    }
  };

  // Sign-UP enforces the full policy; sign-IN only needs a non-empty field.
  // Accounts made before the policy hold passwords that fail it, and refusing
  // to even attempt their login would lock them out.
  const unmet = unmetPasswordRequirements(password);
  const busy = submitting || oauthBusy !== null;
  const disabled =
    busy || !EMAIL_RE.test(email.trim()) || (login ? password.length === 0 : unmet.length > 0);

  const toggleMode = () =>
    router.replace(
      login ? '/(auth)/welcome' : { pathname: '/(auth)/welcome', params: { mode: 'login' } },
    );

  // G2: the in-flight and confirmed states are carried by text, not by a spinner or a colour.
  // Announced explicitly rather than through `accessibilityLiveRegion`, which is Android-only
  // and would have left the confirmation silent on iOS — and, on the in-flight line, spoken
  // twice on Android. The hook re-announces whenever this string changes, which is exactly
  // the two transitions.
  const inFlightLabel = t(login ? 'auth.login.signingIn' : 'auth.signup.creating', locale);
  useAnnounceOnMount(
    submitting ? inFlightLabel : phase === 'sent' ? t('auth.confirm.title', locale) : undefined,
  );

  return (
    // #614: this screen predates the #163 sweep and never picked up the primitive, so the
    // keyboard sat over the password field — the third and last one — with no way to scroll
    // it clear. OUTSIDE `Screen`, which is where every consumer but the two `Screen footer`
    // screens puts it, and what `Screen`'s bottom-inset docblock is written for.
    <KeyboardAvoiding>
      <Screen>
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow px-5 pb-9 pt-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* The back slot is reserved even when there is nothing to go back to (#164): the
            conditional chevron sat the hero ~29pt higher when this screen is the root than
            when it is pushed from the funnel. Real 44pt tap target (DESIGN §10); the empty
            slot, not a disabled button, so screen readers gain no phantom control. */}
          <View className="-ml-3 h-11 w-11">
            {router.canGoBack() ? (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel={t('common.back', locale)}
                className="h-11 w-11 items-center justify-center"
              >
                <Text className="text-2xl text-foreground">‹</Text>
              </Pressable>
            ) : null}
          </View>

          {phase === 'sent' ? (
            /* The confirmation the flow's most important moment used to get as one 14px cyan
              line (#618). Rule #4 call, made explicitly: this is the CONFIRMATION register,
              not the moment register — no ✦, no glow, no `auraSoft`/`auraLine` frame. Nothing
              has happened to the member yet; an account exists and a mail is in flight, and
              the screen's job is to send them to their inbox. `success` carries the state, the
              same reason the password checklist uses it («a satisfied form rule is a
              confirmation, not a moment»). The eyebrow keeps the screen's own hero slot —
              flat cyan text, which rule #4 allows; it is the glow that is reserved. */
            <View className="mt-6 gap-4">
              <SectionLabel tone="aura">{t('auth.confirm.eyebrow', locale)}</SectionLabel>
              <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
                {t('auth.confirm.title', locale)}
              </Text>

              <View className="mt-2 gap-3 rounded-hero border border-hair bg-raise p-5">
                {/* The mark is decoration over text that already says it (G2: state is never
                  carried by colour or a glyph alone), so it is hidden from the reader. */}
                <Text
                  className="text-2xl text-success"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  ✓
                </Text>
                <Text className="text-[15px] leading-[22px] text-foreground">
                  {t('auth.confirm.body', locale, { email: email.trim() })}
                </Text>
                <Text className="text-[13px] text-muted-foreground">
                  {t('auth.confirm.hint', locale)}
                </Text>
              </View>

              {/* A mistyped address is the one failure this screen cannot recover from on its
                own, so the way back to the form is an action, not a re-open of the app. */}
              <Button
                variant="ghost"
                label={t('auth.confirm.changeEmail', locale)}
                onPress={() => setPhase('idle')}
              />
            </View>
          ) : (
            <>
              <View className="mt-6 gap-2">
                <SectionLabel tone="aura">{copy('eyebrow')}</SectionLabel>
                <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">
                  {copy('display')}
                </Text>
                <Text className="text-sm text-muted-foreground">{copy('sub')}</Text>
              </View>

              {/* OAuth on top, per the prototype. Each provider is hidden until it is configured
                in Supabase; with none of them on, the block AND the «oppure con email» divider
                go too — a divider separating email from nothing reads as a broken screen. */}
              {ANY_OAUTH ? (
                <>
                  <View className="mt-7 gap-3">
                    {APPLE_ENABLED ? (
                      <Button
                        variant="outline"
                        label={t('auth.apple.cta', locale)}
                        disabled={busy}
                        loading={oauthBusy === 'apple'}
                        onPress={() => handleOAuth('apple')}
                      />
                    ) : null}

                    {GOOGLE_ENABLED ? (
                      <Button
                        variant="outline"
                        label={t('auth.google.cta', locale)}
                        disabled={busy}
                        loading={oauthBusy === 'google'}
                        onPress={() => handleOAuth('google')}
                      />
                    ) : null}
                  </View>

                  <View className="my-6 flex-row items-center gap-3">
                    <View className="h-px flex-1 bg-hair" />
                    <SectionLabel tone="muted">{t('auth.orEmail', locale)}</SectionLabel>
                    <View className="h-px flex-1 bg-hair" />
                  </View>
                </>
              ) : (
                <View className="mt-7" />
              )}

              <View className="gap-4">
                {!login ? (
                  <View className="gap-2">
                    <Text className="text-xs font-medium text-muted-foreground">
                      {t('auth.name.label', locale)}
                    </Text>
                    <Input
                      autoCapitalize="words"
                      autoComplete="name"
                      textContentType="name"
                      placeholder={t('auth.name.placeholder', locale)}
                      value={name}
                      onChangeText={setName}
                    />
                  </View>
                ) : null}

                <View className="gap-2">
                  <Text className="text-xs font-medium text-muted-foreground">
                    {t('auth.email.label', locale)}
                  </Text>
                  <Input
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    inputMode="email"
                    placeholder={t('auth.email.placeholder', locale)}
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>

                <View className="gap-2">
                  <Text className="text-xs font-medium text-muted-foreground">
                    {t('auth.password.label', locale)}
                  </Text>
                  {/* #615: `textContentType` is iOS-only and OVERRIDES the value RN derives from
                    `autoComplete` (TextInput.js maps one to the other only when the explicit prop
                    is absent), so the two props can be set independently — Android keeps its
                    password manager through `autoComplete`, iOS gets exactly the AutoFill asked
                    for here. Signup takes `none`: `newPassword` is what puts iOS's strong-password
                    overlay on the field, and a committed suggestion REPLACES the whole value on
                    re-focus, which is hypothesis 2 of the report («re-editing replaces the line»).
                    Sign-in keeps `password`, where a full-field fill is the point. Hypothesis 1
                    — UIKit clearing a secure field when editing resumes — has no call-site
                    remedy short of dropping `secureTextEntry`; see the PR's device notes. */}
                  <Input
                    autoCapitalize="none"
                    autoComplete={login ? 'current-password' : 'new-password'}
                    textContentType={login ? 'password' : 'none'}
                    secureTextEntry={!revealed}
                    placeholder={t('auth.password.placeholder', locale)}
                    value={password}
                    onChangeText={setPassword}
                    // The `eye` from the esoteric set (DESIGN §6), inside the field where the
                    // affordance is looked for. SHAPE carries the state — struck vs open — so
                    // both variants keep the same muted token: a reveal is confirmation-grade,
                    // never a moment, so no cyan and no glow (rule 4). The label swaps with it,
                    // because a glyph alone tells a screen reader nothing (G2). `Input` owns
                    // the 44pt box; see its docblock for why the caller does not.
                    trailing={{
                      icon: revealed ? <EyeOffGlyph size={20} /> : <EyeGlyph size={20} />,
                      onPress: () => setRevealed((shown) => !shown),
                      accessibilityLabel: t(
                        revealed ? 'a11y.password.hide' : 'a11y.password.show',
                        locale,
                      ),
                    }}
                  />
                  {/* Signup only — the rule is stated once before typing, then becomes a
                    live checklist. `success`, not `aura`: a satisfied form rule is a
                    confirmation, not a moment (rule 4). Met/unmet is carried by the
                    mark and by an explicit SR label, not by colour alone (G2). */}
                  {!login && password.length === 0 ? (
                    <Text className="px-5 text-xs text-muted-foreground">
                      {t('auth.password.hint', locale)}
                    </Text>
                  ) : null}
                  {!login && password.length > 0 ? (
                    <View className="gap-1 px-5">
                      {PASSWORD_REQUIREMENTS.map((requirement) => {
                        const met = !unmet.includes(requirement);
                        const label = t(`auth.password.req.${requirement}`, locale);
                        return (
                          <Text
                            key={requirement}
                            className={`text-xs ${met ? 'text-success' : 'text-muted-foreground'}`}
                            accessibilityLabel={`${t(met ? 'a11y.req.met' : 'a11y.req.unmet', locale)} ${label}`}
                          >
                            {met ? '✓' : '•'} {label}
                          </Text>
                        );
                      })}
                    </View>
                  ) : null}
                  {/* #631: the one recovery path an email member has. Login mode only —
                    a signup has no password to forget. Real 44pt box (min-h + centering,
                    not hitSlop arithmetic on 13px text — the tap-target sweep's lesson),
                    left-aligned under the field it rescues. Carries the typed email so
                    the next screen starts filled. */}
                  {login ? (
                    <Pressable
                      className="min-h-[44px] justify-center px-5"
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/(auth)/forgot-password',
                          params: email.trim() ? { email: email.trim() } : {},
                        })
                      }
                    >
                      <Text className="text-[13px] text-muted-foreground">
                        {t('auth.forgot.link', locale)}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {error ? <Text className="text-sm text-error">{error}</Text> : null}
              </View>

              {/* `Button` owns the pill; the screen keeps the gap above it, because a
                component that carried its own outer margin could not be reused in a row. */}
              <View className="mt-7 gap-3">
                <Button
                  variant="light"
                  label={t(login ? 'auth.login.cta' : 'auth.signup.cta', locale)}
                  disabled={disabled}
                  loading={submitting}
                  onPress={submit}
                />
                {/* The spinner alone said only «something is happening». This names it, and
                  keeps saying it across the session hop the spinner now rides out (#618). */}
                {submitting ? (
                  <Text className="text-center text-[13px] text-muted-foreground">
                    {inFlightLabel}
                  </Text>
                ) : null}
                {/* #632: the point of collection is the point of consent — GDPR-scoped
                  product collecting a name, an email and a dream. Signup only; sign-in
                  agreed at signup. The two links reuse settings' labels and URLs so the
                  words match the screen that also carries them. */}
                {!login ? (
                  <View className="gap-1">
                    <Text className="text-center text-xs leading-4 text-muted-foreground">
                      {t('auth.legal.notice', locale)}
                    </Text>
                    <View className="flex-row items-center justify-center gap-6">
                      {(
                        [
                          ['settings.legal.terms', LEGAL_TERMS_URL],
                          ['settings.legal.privacy', LEGAL_PRIVACY_URL],
                        ] as const
                      ).map(([key, url]) => (
                        <Pressable
                          key={key}
                          className="min-h-[44px] justify-center"
                          accessibilityRole="link"
                          onPress={() => {
                            WebBrowser.openBrowserAsync(url).catch(() =>
                              setError(t('settings.legal.error', locale)),
                            );
                          }}
                        >
                          <Text className="text-xs text-muted-foreground underline">
                            {t(key, locale)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              <Pressable
                className="mt-6 items-center"
                onPress={toggleMode}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text className="text-[13px] text-muted-foreground">
                  {t(login ? 'auth.noAccount' : 'auth.haveAccount', locale)}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </Screen>
    </KeyboardAvoiding>
  );
}
