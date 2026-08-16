--
-- PostgreSQL database dump
--

\restrict AnPt4GkB0vOfrXvAXFj0IqADa5i1J08fd81PrmhkgAIKPjHoaHJKoyNGQN5MJCg

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    set_id uuid,
    grant_type text NOT NULL,
    granted_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    coins_paid integer DEFAULT 0,
    scope text DEFAULT 'tier'::text NOT NULL
);


--
-- Name: active_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id uuid NOT NULL,
    device_hint text,
    created_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now()
);


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: artist_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    fan_id uuid,
    payload jsonb,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bonus_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text,
    bonus_pct numeric(5,2) NOT NULL,
    label text,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    min_tokens integer DEFAULT 0 NOT NULL,
    max_uses integer,
    uses integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    multiplier numeric(4,2) DEFAULT 1.0,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: call_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    call_type text NOT NULL,
    status text DEFAULT 'pending'::text,
    coins_per_min integer NOT NULL,
    stream_call_id text,
    created_at timestamp with time zone DEFAULT now(),
    coins_charged integer DEFAULT 0 NOT NULL,
    rejection_reason text,
    proposed_time timestamp with time zone,
    proposed_by text,
    negotiation_round integer DEFAULT 1 NOT NULL,
    scheduled_at timestamp with time zone,
    reminder_sent boolean DEFAULT false NOT NULL,
    fan_joined_at timestamp with time zone,
    artist_joined_at timestamp with time zone,
    call_started_at timestamp with time zone,
    ring_expires_at timestamp with time zone
);


--
-- Name: canned_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canned_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coin_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coin_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    type text NOT NULL,
    amount integer NOT NULL,
    label text,
    funding_rail text,
    processor_tx_id text,
    consent_version text,
    consented_at timestamp with time zone,
    related_purchase_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    direction text DEFAULT 'debit'::text NOT NULL,
    payment_id text,
    payment_amount_inr integer,
    related_id uuid,
    from_gifted integer DEFAULT 0 NOT NULL,
    from_purchased integer DEFAULT 0 NOT NULL,
    refunded_at timestamp with time zone,
    from_bonus integer DEFAULT 0 NOT NULL,
    bonus_offer_id uuid,
    CONSTRAINT coin_ledger_type_check CHECK ((type = ANY (ARRAY['call_charge'::text, 'call_refund'::text, 'chat_media_unlock'::text, 'dm_charge'::text, 'content_unlock'::text, 'recharge'::text, 'community_credits'::text, 'custom_request'::text, 'request_refund'::text, 'membership_purchase'::text, 'membership_upgrade'::text, 'membership_extend'::text, 'membership_refund'::text, 'merch_purchase'::text, 'merch_refund'::text, 'grant'::text, 'gifted_membership'::text, 'debit'::text, 'gift'::text, 'refund'::text])))
);


--
-- Name: community_chat_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_chat_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    hour_key text NOT NULL,
    day_key text NOT NULL,
    messages_this_hour integer DEFAULT 0,
    messages_today integer DEFAULT 0
);


--
-- Name: community_daily_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_daily_usage (
    user_id uuid NOT NULL,
    day_key text NOT NULL,
    posts_used integer DEFAULT 0 NOT NULL
);


--
-- Name: community_poll_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_poll_votes (
    poll_id uuid NOT NULL,
    user_id uuid NOT NULL,
    option_index integer NOT NULL,
    voted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_polls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    question text NOT NULL,
    option_kind text DEFAULT 'text'::text NOT NULL,
    options jsonb NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    tier_scope text DEFAULT 'community'::text NOT NULL,
    content text NOT NULL,
    pinned boolean DEFAULT false,
    removed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    is_system boolean DEFAULT false,
    update_kind text,
    parent_id uuid,
    post_kind text DEFAULT 'message'::text NOT NULL
);


--
-- Name: community_question_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_question_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    prompt text NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: content_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    type text NOT NULL,
    details text NOT NULL,
    coins_charged integer NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    reference_url text,
    rejection_reason text,
    extra_item_id uuid,
    topic text,
    reference_image_key text,
    expected_delivery_date date,
    offered_price_coins integer,
    counter_price_coins integer,
    counter_note text,
    consent_agreed boolean DEFAULT false NOT NULL,
    delivery_email text,
    delivery_whatsapp text,
    delivery_channel text
);


--
-- Name: daily_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_quotes (
    id integer NOT NULL,
    quote text NOT NULL,
    author text NOT NULL
);


--
-- Name: daily_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_quotes_id_seq OWNED BY public.daily_quotes.id;


--
-- Name: daily_selfies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_selfies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    image_key text NOT NULL,
    caption text,
    selfie_date date NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seq bigint NOT NULL
);


--
-- Name: daily_selfies_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_selfies_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_selfies_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_selfies_seq_seq OWNED BY public.daily_selfies.seq;


--
-- Name: daily_thoughts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_thoughts (
    id integer NOT NULL,
    thought text NOT NULL
);


--
-- Name: daily_thoughts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_thoughts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_thoughts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_thoughts_id_seq OWNED BY public.daily_thoughts.id;


--
-- Name: direct_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid,
    recipient_id uuid,
    content text NOT NULL,
    tokens_charged integer DEFAULT 0 NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    media_url text,
    media_type text,
    locked_media_urls jsonb,
    unlock_price_coins integer,
    unlocked_at timestamp with time zone,
    media_duration_seconds integer,
    deleted_at timestamp with time zone,
    parent_id uuid
);


--
-- Name: extras_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extras_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    price_coins integer NOT NULL,
    visible boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: fan_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fan_settings (
    user_id uuid NOT NULL,
    custom_chat_price integer,
    can_send_media boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now(),
    personal_chat_bg text,
    custom_messages_per_token integer,
    messages_since_charge integer DEFAULT 0 NOT NULL
);


--
-- Name: fx_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fx_rates (
    currency text NOT NULL,
    inr_per_unit numeric(12,4) NOT NULL,
    symbol text NOT NULL,
    label text NOT NULL,
    decimals integer DEFAULT 2 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    source text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gifted_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifted_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    remaining integer NOT NULL,
    source text NOT NULL,
    note text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_id uuid,
    coins_amount integer NOT NULL,
    funding_method text NOT NULL,
    processor_tx_id text,
    consent_version text,
    consented_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoice_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_counters (
    day_key text NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


--
-- Name: invoice_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    receipt_number text,
    received_on date DEFAULT CURRENT_DATE NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    amount_in_currency numeric(14,2) NOT NULL,
    exchange_rate numeric(14,6),
    amount_credited_inr numeric(14,2) NOT NULL,
    method text,
    reference text,
    efirc_number text,
    efirc_file_key text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    user_id uuid NOT NULL,
    coin_ledger_id uuid,
    user_email text NOT NULL,
    user_country text,
    payment_method_display text,
    currency text NOT NULL,
    amount_in_currency numeric NOT NULL,
    exchange_rate_used numeric,
    amount_inr_equivalent numeric NOT NULL,
    tokens_purchased integer NOT NULL,
    is_export boolean DEFAULT false NOT NULL,
    gst_rate_pct numeric DEFAULT 0 NOT NULL,
    gst_amount_inr numeric DEFAULT 0 NOT NULL,
    taxable_amount_inr numeric NOT NULL,
    pdf_url text,
    emailed_at timestamp with time zone,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    sac_code text,
    ip_address text,
    cgst_amount_inr numeric(12,2) DEFAULT 0 NOT NULL,
    sgst_amount_inr numeric(12,2) DEFAULT 0 NOT NULL,
    igst_amount_inr numeric(12,2) DEFAULT 0 NOT NULL,
    place_of_supply text,
    export_with_tax boolean DEFAULT false NOT NULL
);


--
-- Name: issued_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issued_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    invoice_number text NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    recipient_name text NOT NULL,
    recipient_email text,
    recipient_address text,
    recipient_gstin text,
    recipient_state text,
    recipient_country text DEFAULT 'India'::text NOT NULL,
    place_of_supply text,
    reverse_charge boolean DEFAULT false NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    taxable_amount numeric(12,2) DEFAULT 0 NOT NULL,
    cgst_amount numeric(12,2) DEFAULT 0 NOT NULL,
    sgst_amount numeric(12,2) DEFAULT 0 NOT NULL,
    igst_amount numeric(12,2) DEFAULT 0 NOT NULL,
    gst_rate_pct numeric(5,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    is_export boolean DEFAULT false NOT NULL,
    payment_account_id uuid,
    notes text,
    paid_at timestamp with time zone,
    payment_reference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT issued_invoices_kind_check CHECK ((kind = ANY (ARRAY['manual'::text, 'b2b'::text])))
);


--
-- Name: jinal_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jinal_quotes (
    id integer NOT NULL,
    quote text NOT NULL,
    active boolean DEFAULT true
);


--
-- Name: jinal_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jinal_quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jinal_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jinal_quotes_id_seq OWNED BY public.jinal_quotes.id;


--
-- Name: membership_gifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_gifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    granted_by uuid,
    recipient_email text NOT NULL,
    recipient_id uuid,
    tier text NOT NULL,
    term text NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: membership_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stage text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merch_bids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merch_bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merch_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    charity_key text,
    display_winner_name boolean DEFAULT false,
    over_balance_consent boolean DEFAULT false NOT NULL
);


--
-- Name: merch_drop_interest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merch_drop_interest (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    drop_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notified_at timestamp with time zone
);


--
-- Name: merch_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merch_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    r2_key text NOT NULL,
    original_filename text,
    width integer,
    height integer,
    bytes integer,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchandise; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchandise (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    price_coins integer NOT NULL,
    total_stock integer NOT NULL,
    remaining integer NOT NULL,
    img_key text,
    visible boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    description text,
    is_auction_item boolean DEFAULT false NOT NULL,
    csr_pct integer,
    auction_status text DEFAULT 'queued'::text NOT NULL,
    had_auction_turn boolean DEFAULT false NOT NULL,
    auction_started_at timestamp with time zone,
    went_unsold_at timestamp with time zone,
    current_highest_bid integer,
    current_highest_bidder_id uuid,
    winner_id uuid,
    won_at timestamp with time zone,
    winner_email_sent_at timestamp with time zone,
    sold_price_coins integer,
    sold_via text,
    charity_key text,
    display_winner_name boolean,
    donation_confirmed_at date,
    claim_stage integer DEFAULT 0 NOT NULL,
    claim_deadline timestamp with time zone,
    donation_reference text
);


--
-- Name: merchandise_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchandise_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merch_id uuid NOT NULL,
    url text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: moderation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_user_id uuid,
    action_type text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: monthly_allotments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_allotments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    month_key text NOT NULL,
    unlocks_used integer DEFAULT 0,
    messages_used integer DEFAULT 0,
    free_set_used boolean DEFAULT false,
    recovery_otp_used integer DEFAULT 0,
    free_dms_used integer DEFAULT 0,
    free_dms_today integer DEFAULT 0,
    dms_date date,
    community_chat_paid_date date,
    community_posts_used integer DEFAULT 0
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    merch_id uuid,
    coins_charged integer NOT NULL,
    shipping_address jsonb,
    status text DEFAULT 'paid'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: payment_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    currency text NOT NULL,
    is_domestic boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    details_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: photographer_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photographer_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    photographer_id uuid NOT NULL,
    amount_inr numeric(12,2) NOT NULL,
    reference text,
    note text,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: photographers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photographers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    draft_value text
);


--
-- Name: platform_config_orphans_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config_orphans_backup (
    key text,
    value text,
    updated_at timestamp with time zone,
    draft_value text
);


--
-- Name: portfolio_hero_slides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_hero_slides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    image_key text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portfolio_works; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolio_works (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    year text,
    "character" text,
    watch_now_url text,
    trailer_url text,
    image_key text,
    "position" integer DEFAULT 0 NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: selfie_passes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selfie_passes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    from_seq bigint NOT NULL,
    to_seq bigint NOT NULL,
    posts_covered integer NOT NULL,
    coin_ledger_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: selfie_unlocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selfie_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    selfie_id uuid NOT NULL,
    coin_ledger_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: set_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.set_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_id uuid,
    type text NOT NULL,
    r2_key text NOT NULL,
    "position" integer,
    created_at timestamp with time zone DEFAULT now(),
    media_type text DEFAULT 'image'::text,
    tier_category text DEFAULT 'community'::text NOT NULL,
    quality jsonb
);


--
-- Name: set_photographers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.set_photographers (
    set_id uuid NOT NULL,
    photographer_id uuid NOT NULL
);


--
-- Name: set_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.set_views (
    user_id uuid NOT NULL,
    set_id uuid NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    mode text DEFAULT 'standard'::text NOT NULL,
    price_coins integer NOT NULL,
    visible boolean DEFAULT false,
    cover_key text,
    created_at timestamp with time zone DEFAULT now(),
    min_tier text DEFAULT 'community'::text NOT NULL,
    use_unlock_credit boolean DEFAULT true,
    category text DEFAULT 'content'::text NOT NULL,
    description text,
    photographer_id uuid,
    published_at timestamp with time zone,
    is_vault boolean DEFAULT false NOT NULL,
    cover_blur text,
    cover_og_key text
);


--
-- Name: user_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_access_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    ip_address text,
    country text,
    country_code text,
    event_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    password_hash text,
    dob date,
    display_name text,
    tier text DEFAULT 'guest'::text NOT NULL,
    membership_expires_at timestamp with time zone,
    coin_balance integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    email text,
    is_phone_verified boolean DEFAULT false,
    is_adult_confirmed boolean DEFAULT false,
    phone_verified_at timestamp with time zone,
    last_login_at timestamp with time zone,
    is_artist boolean DEFAULT false,
    membership_term text,
    membership_started_at timestamp with time zone,
    consent_terms boolean DEFAULT false,
    consent_no_refund boolean DEFAULT false,
    consented_at timestamp with time zone,
    shipping_name text,
    shipping_phone text,
    shipping_line1 text,
    shipping_city text,
    shipping_state text,
    shipping_pincode text,
    community_message_credits integer DEFAULT 0 NOT NULL,
    preferred_currency text DEFAULT 'INR'::text NOT NULL,
    signup_country text,
    signup_country_code text,
    is_muted boolean DEFAULT false NOT NULL,
    blocked_until timestamp with time zone,
    block_count integer DEFAULT 0 NOT NULL,
    block_reason text,
    email_verified boolean DEFAULT false NOT NULL,
    timezone text,
    hide_system_posts boolean DEFAULT false NOT NULL,
    auction_banned_until timestamp with time zone,
    unclaimed_wins integer DEFAULT 0 NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    detected_country text,
    bonus_balance integer DEFAULT 0 NOT NULL
);


--
-- Name: verification_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    purpose text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_quotes ALTER COLUMN id SET DEFAULT nextval('public.daily_quotes_id_seq'::regclass);


--
-- Name: daily_selfies seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_selfies ALTER COLUMN seq SET DEFAULT nextval('public.daily_selfies_seq_seq'::regclass);


--
-- Name: daily_thoughts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_thoughts ALTER COLUMN id SET DEFAULT nextval('public.daily_thoughts_id_seq'::regclass);


--
-- Name: jinal_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jinal_quotes ALTER COLUMN id SET DEFAULT nextval('public.jinal_quotes_id_seq'::regclass);


--
-- Name: access_grants access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_pkey PRIMARY KEY (id);


--
-- Name: access_grants access_grants_user_id_set_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_user_id_set_id_key UNIQUE (user_id, set_id);


--
-- Name: active_sessions active_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_pkey PRIMARY KEY (id);


--
-- Name: active_sessions active_sessions_user_session_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_user_session_unique UNIQUE (user_id, session_id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: artist_notifications artist_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_notifications
    ADD CONSTRAINT artist_notifications_pkey PRIMARY KEY (id);


--
-- Name: bonus_offers bonus_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_offers
    ADD CONSTRAINT bonus_offers_pkey PRIMARY KEY (id);


--
-- Name: call_availability call_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_availability
    ADD CONSTRAINT call_availability_pkey PRIMARY KEY (id);


--
-- Name: call_requests call_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_requests
    ADD CONSTRAINT call_requests_pkey PRIMARY KEY (id);


--
-- Name: canned_replies canned_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canned_replies
    ADD CONSTRAINT canned_replies_pkey PRIMARY KEY (id);


--
-- Name: coin_ledger coin_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_ledger
    ADD CONSTRAINT coin_ledger_pkey PRIMARY KEY (id);


--
-- Name: community_chat_usage community_chat_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_chat_usage
    ADD CONSTRAINT community_chat_usage_pkey PRIMARY KEY (id);


--
-- Name: community_chat_usage community_chat_usage_user_id_hour_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_chat_usage
    ADD CONSTRAINT community_chat_usage_user_id_hour_key_key UNIQUE (user_id, hour_key);


--
-- Name: community_daily_usage community_daily_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_daily_usage
    ADD CONSTRAINT community_daily_usage_pkey PRIMARY KEY (user_id, day_key);


--
-- Name: community_polls community_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_polls
    ADD CONSTRAINT community_polls_pkey PRIMARY KEY (id);


--
-- Name: community_posts community_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);


--
-- Name: community_question_windows community_question_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_question_windows
    ADD CONSTRAINT community_question_windows_pkey PRIMARY KEY (id);


--
-- Name: content_reports content_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_pkey PRIMARY KEY (id);


--
-- Name: custom_requests custom_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_requests
    ADD CONSTRAINT custom_requests_pkey PRIMARY KEY (id);


--
-- Name: daily_quotes daily_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_quotes
    ADD CONSTRAINT daily_quotes_pkey PRIMARY KEY (id);


--
-- Name: daily_selfies daily_selfies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_selfies
    ADD CONSTRAINT daily_selfies_pkey PRIMARY KEY (id);


--
-- Name: daily_thoughts daily_thoughts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_thoughts
    ADD CONSTRAINT daily_thoughts_pkey PRIMARY KEY (id);


--
-- Name: direct_messages direct_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);


--
-- Name: extras_items extras_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_items
    ADD CONSTRAINT extras_items_pkey PRIMARY KEY (id);


--
-- Name: fan_settings fan_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fan_settings
    ADD CONSTRAINT fan_settings_pkey PRIMARY KEY (user_id);


--
-- Name: fx_rates fx_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_rates
    ADD CONSTRAINT fx_rates_pkey PRIMARY KEY (currency);


--
-- Name: gifted_grants gifted_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifted_grants
    ADD CONSTRAINT gifted_grants_pkey PRIMARY KEY (id);


--
-- Name: gifts gifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_pkey PRIMARY KEY (id);


--
-- Name: invoice_counters invoice_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_counters
    ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (day_key);


--
-- Name: invoice_receipts invoice_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_receipts
    ADD CONSTRAINT invoice_receipts_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: issued_invoices issued_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_invoices
    ADD CONSTRAINT issued_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: issued_invoices issued_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_invoices
    ADD CONSTRAINT issued_invoices_pkey PRIMARY KEY (id);


--
-- Name: jinal_quotes jinal_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jinal_quotes
    ADD CONSTRAINT jinal_quotes_pkey PRIMARY KEY (id);


--
-- Name: membership_gifts membership_gifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_gifts
    ADD CONSTRAINT membership_gifts_pkey PRIMARY KEY (id);


--
-- Name: membership_reminders membership_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_reminders
    ADD CONSTRAINT membership_reminders_pkey PRIMARY KEY (id);


--
-- Name: membership_reminders membership_reminders_user_id_stage_expires_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_reminders
    ADD CONSTRAINT membership_reminders_user_id_stage_expires_at_key UNIQUE (user_id, stage, expires_at);


--
-- Name: merch_bids merch_bids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_bids
    ADD CONSTRAINT merch_bids_pkey PRIMARY KEY (id);


--
-- Name: merch_drop_interest merch_drop_interest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_drop_interest
    ADD CONSTRAINT merch_drop_interest_pkey PRIMARY KEY (id);


--
-- Name: merch_drop_interest merch_drop_interest_user_id_drop_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_drop_interest
    ADD CONSTRAINT merch_drop_interest_user_id_drop_key_key UNIQUE (user_id, drop_key);


--
-- Name: merch_media merch_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_media
    ADD CONSTRAINT merch_media_pkey PRIMARY KEY (id);


--
-- Name: merchandise_images merchandise_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchandise_images
    ADD CONSTRAINT merchandise_images_pkey PRIMARY KEY (id);


--
-- Name: merchandise merchandise_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchandise
    ADD CONSTRAINT merchandise_pkey PRIMARY KEY (id);


--
-- Name: moderation_log moderation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_log
    ADD CONSTRAINT moderation_log_pkey PRIMARY KEY (id);


--
-- Name: monthly_allotments monthly_allotments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_allotments
    ADD CONSTRAINT monthly_allotments_pkey PRIMARY KEY (id);


--
-- Name: monthly_allotments monthly_allotments_user_id_month_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_allotments
    ADD CONSTRAINT monthly_allotments_user_id_month_key_key UNIQUE (user_id, month_key);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_accounts payment_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_accounts
    ADD CONSTRAINT payment_accounts_pkey PRIMARY KEY (id);


--
-- Name: photographer_payments photographer_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographer_payments
    ADD CONSTRAINT photographer_payments_pkey PRIMARY KEY (id);


--
-- Name: photographers photographers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographers
    ADD CONSTRAINT photographers_pkey PRIMARY KEY (id);


--
-- Name: platform_config platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (key);


--
-- Name: portfolio_hero_slides portfolio_hero_slides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_hero_slides
    ADD CONSTRAINT portfolio_hero_slides_pkey PRIMARY KEY (id);


--
-- Name: portfolio_works portfolio_works_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolio_works
    ADD CONSTRAINT portfolio_works_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);


--
-- Name: selfie_passes selfie_passes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selfie_passes
    ADD CONSTRAINT selfie_passes_pkey PRIMARY KEY (id);


--
-- Name: selfie_unlocks selfie_unlocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selfie_unlocks
    ADD CONSTRAINT selfie_unlocks_pkey PRIMARY KEY (id);


--
-- Name: selfie_unlocks selfie_unlocks_user_id_selfie_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selfie_unlocks
    ADD CONSTRAINT selfie_unlocks_user_id_selfie_id_key UNIQUE (user_id, selfie_id);


--
-- Name: set_items set_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_items
    ADD CONSTRAINT set_items_pkey PRIMARY KEY (id);


--
-- Name: set_photographers set_photographers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_photographers
    ADD CONSTRAINT set_photographers_pkey PRIMARY KEY (set_id, photographer_id);


--
-- Name: set_views set_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_views
    ADD CONSTRAINT set_views_pkey PRIMARY KEY (user_id, set_id);


--
-- Name: sets sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_pkey PRIMARY KEY (id);


--
-- Name: user_access_log user_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_access_log
    ADD CONSTRAINT user_access_log_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verification_tokens verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: verification_tokens verification_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_token_key UNIQUE (token);


--
-- Name: bonus_offers_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bonus_offers_code_idx ON public.bonus_offers USING btree (lower(code)) WHERE (code IS NOT NULL);


--
-- Name: bonus_offers_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bonus_offers_live_idx ON public.bonus_offers USING btree (ends_at DESC) WHERE (active = true);


--
-- Name: community_poll_votes_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX community_poll_votes_pk ON public.community_poll_votes USING btree (poll_id, user_id);


--
-- Name: community_polls_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_polls_open_idx ON public.community_polls USING btree (closes_at DESC);


--
-- Name: community_posts_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_posts_parent_idx ON public.community_posts USING btree (parent_id, created_at);


--
-- Name: daily_selfies_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX daily_selfies_date_idx ON public.daily_selfies USING btree (selfie_date);


--
-- Name: direct_messages_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX direct_messages_parent_idx ON public.direct_messages USING btree (parent_id);


--
-- Name: gifted_grants_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gifted_grants_live_idx ON public.gifted_grants USING btree (user_id, expires_at) WHERE (remaining > 0);


--
-- Name: idx_access_grants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_grants_user ON public.access_grants USING btree (user_id);


--
-- Name: idx_active_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_sessions_user_id ON public.active_sessions USING btree (user_id);


--
-- Name: idx_call_availability_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_availability_dates ON public.call_availability USING btree (start_date, end_date);


--
-- Name: idx_chat_usage_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_usage_user_day ON public.community_chat_usage USING btree (user_id, day_key);


--
-- Name: idx_coin_ledger_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coin_ledger_type ON public.coin_ledger USING btree (type);


--
-- Name: idx_coin_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coin_ledger_user ON public.coin_ledger USING btree (user_id, created_at DESC);


--
-- Name: idx_community_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_tier ON public.community_posts USING btree (tier_scope, removed);


--
-- Name: idx_dm_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_conversation ON public.direct_messages USING btree (sender_id, recipient_id, created_at DESC);


--
-- Name: idx_invoices_issued_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_issued_at ON public.invoices USING btree (issued_at);


--
-- Name: idx_invoices_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_user_id ON public.invoices USING btree (user_id);


--
-- Name: idx_membership_gifts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_gifts_email ON public.membership_gifts USING btree (recipient_email);


--
-- Name: idx_merch_bids_merch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merch_bids_merch_id ON public.merch_bids USING btree (merch_id);


--
-- Name: idx_monthly_user_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_user_month ON public.monthly_allotments USING btree (user_id, month_key);


--
-- Name: idx_notifs_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifs_unread ON public.artist_notifications USING btree (read, created_at DESC);


--
-- Name: idx_push_subs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subs_user ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_sets_visible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sets_visible ON public.sets USING btree (visible, min_tier);


--
-- Name: idx_user_access_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_access_log_user_id ON public.user_access_log USING btree (user_id);


--
-- Name: idx_verification_tokens_user_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verification_tokens_user_purpose ON public.verification_tokens USING btree (user_id, purpose);


--
-- Name: invoice_receipts_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_receipts_invoice_idx ON public.invoice_receipts USING btree (invoice_id, received_on);


--
-- Name: issued_invoices_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX issued_invoices_kind_idx ON public.issued_invoices USING btree (kind, invoice_date DESC);


--
-- Name: membership_reminders_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_reminders_user_idx ON public.membership_reminders USING btree (user_id);


--
-- Name: merch_drop_interest_drop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merch_drop_interest_drop_idx ON public.merch_drop_interest USING btree (drop_key);


--
-- Name: merch_media_filename_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merch_media_filename_idx ON public.merch_media USING btree (lower(original_filename));


--
-- Name: merch_media_uploaded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merch_media_uploaded_idx ON public.merch_media USING btree (uploaded_at DESC);


--
-- Name: merchandise_images_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchandise_images_order_idx ON public.merchandise_images USING btree (merch_id, "position");


--
-- Name: monthly_allotments_user_month; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX monthly_allotments_user_month ON public.monthly_allotments USING btree (user_id, month_key);


--
-- Name: photographer_payments_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX photographer_payments_idx ON public.photographer_payments USING btree (photographer_id, paid_at DESC);


--
-- Name: photographers_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX photographers_name_idx ON public.photographers USING btree (lower(name));


--
-- Name: selfie_passes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX selfie_passes_user_idx ON public.selfie_passes USING btree (user_id, to_seq);


--
-- Name: set_items_flagged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX set_items_flagged_idx ON public.set_items USING btree (set_id) WHERE ((quality IS NOT NULL) AND ((quality ->> 'flag'::text) IS NOT NULL));


--
-- Name: set_photographers_photographer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX set_photographers_photographer_idx ON public.set_photographers USING btree (photographer_id);


--
-- Name: set_views_set_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX set_views_set_idx ON public.set_views USING btree (set_id, first_seen DESC);


--
-- Name: sets_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sets_published_idx ON public.sets USING btree (published_at DESC) WHERE (visible = true);


--
-- Name: access_grants access_grants_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.sets(id);


--
-- Name: access_grants access_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_grants
    ADD CONSTRAINT access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: active_sessions active_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artist_notifications artist_notifications_fan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_notifications
    ADD CONSTRAINT artist_notifications_fan_id_fkey FOREIGN KEY (fan_id) REFERENCES public.users(id);


--
-- Name: call_requests call_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_requests
    ADD CONSTRAINT call_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: coin_ledger coin_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coin_ledger
    ADD CONSTRAINT coin_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: community_chat_usage community_chat_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_chat_usage
    ADD CONSTRAINT community_chat_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: community_daily_usage community_daily_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_daily_usage
    ADD CONSTRAINT community_daily_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: community_polls community_polls_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_polls
    ADD CONSTRAINT community_polls_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: community_posts community_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: content_reports content_reports_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: content_reports content_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reports
    ADD CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: custom_requests custom_requests_extra_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_requests
    ADD CONSTRAINT custom_requests_extra_item_id_fkey FOREIGN KEY (extra_item_id) REFERENCES public.extras_items(id);


--
-- Name: custom_requests custom_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_requests
    ADD CONSTRAINT custom_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: direct_messages direct_messages_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);


--
-- Name: direct_messages direct_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: fan_settings fan_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fan_settings
    ADD CONSTRAINT fan_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: gifted_grants gifted_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifted_grants
    ADD CONSTRAINT gifted_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: gifts gifts_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifts
    ADD CONSTRAINT gifts_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: invoices invoices_coin_ledger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_coin_ledger_id_fkey FOREIGN KEY (coin_ledger_id) REFERENCES public.coin_ledger(id);


--
-- Name: invoices invoices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: issued_invoices issued_invoices_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issued_invoices
    ADD CONSTRAINT issued_invoices_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.payment_accounts(id);


--
-- Name: membership_gifts membership_gifts_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_gifts
    ADD CONSTRAINT membership_gifts_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: membership_gifts membership_gifts_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_gifts
    ADD CONSTRAINT membership_gifts_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);


--
-- Name: membership_reminders membership_reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_reminders
    ADD CONSTRAINT membership_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: merch_bids merch_bids_merch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_bids
    ADD CONSTRAINT merch_bids_merch_id_fkey FOREIGN KEY (merch_id) REFERENCES public.merchandise(id) ON DELETE CASCADE;


--
-- Name: merch_bids merch_bids_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_bids
    ADD CONSTRAINT merch_bids_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: merch_drop_interest merch_drop_interest_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_drop_interest
    ADD CONSTRAINT merch_drop_interest_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: merchandise merchandise_current_highest_bidder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchandise
    ADD CONSTRAINT merchandise_current_highest_bidder_id_fkey FOREIGN KEY (current_highest_bidder_id) REFERENCES public.users(id);


--
-- Name: merchandise_images merchandise_images_merch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchandise_images
    ADD CONSTRAINT merchandise_images_merch_id_fkey FOREIGN KEY (merch_id) REFERENCES public.merchandise(id) ON DELETE CASCADE;


--
-- Name: merchandise merchandise_winner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchandise
    ADD CONSTRAINT merchandise_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.users(id);


--
-- Name: moderation_log moderation_log_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_log
    ADD CONSTRAINT moderation_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id);


--
-- Name: monthly_allotments monthly_allotments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_allotments
    ADD CONSTRAINT monthly_allotments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: orders orders_merch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_merch_id_fkey FOREIGN KEY (merch_id) REFERENCES public.merchandise(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: photographer_payments photographer_payments_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photographer_payments
    ADD CONSTRAINT photographer_payments_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: selfie_passes selfie_passes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selfie_passes
    ADD CONSTRAINT selfie_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: selfie_unlocks selfie_unlocks_selfie_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selfie_unlocks
    ADD CONSTRAINT selfie_unlocks_selfie_id_fkey FOREIGN KEY (selfie_id) REFERENCES public.daily_selfies(id) ON DELETE CASCADE;


--
-- Name: selfie_unlocks selfie_unlocks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selfie_unlocks
    ADD CONSTRAINT selfie_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: set_items set_items_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_items
    ADD CONSTRAINT set_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.sets(id);


--
-- Name: set_photographers set_photographers_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_photographers
    ADD CONSTRAINT set_photographers_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id) ON DELETE CASCADE;


--
-- Name: set_photographers set_photographers_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_photographers
    ADD CONSTRAINT set_photographers_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.sets(id) ON DELETE CASCADE;


--
-- Name: set_views set_views_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_views
    ADD CONSTRAINT set_views_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.sets(id) ON DELETE CASCADE;


--
-- Name: set_views set_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_views
    ADD CONSTRAINT set_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sets sets_photographer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_photographer_id_fkey FOREIGN KEY (photographer_id) REFERENCES public.photographers(id);


--
-- Name: user_access_log user_access_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_access_log
    ADD CONSTRAINT user_access_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: verification_tokens verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict AnPt4GkB0vOfrXvAXFj0IqADa5i1J08fd81PrmhkgAIKPjHoaHJKoyNGQN5MJCg

