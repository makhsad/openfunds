use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("Hcy7KiWQE1VfWE8LieGUSq8yAeL1AZEMqjKhDjomc7Fe");

#[program]
pub mod openfunds {
    use super::*;

    pub fn initialize_campaign(ctx: Context<InitializeCampaign>) -> Result<()> {
        ctx.accounts.campaign.creator = ctx.accounts.creator.key();
        ctx.accounts.campaign.total_contributed = 0;
        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount_lamports: u64) -> Result<()> {
        require!(
            ctx.accounts
                .campaign
                .to_account_info()
                .try_borrow_data()?
                .get(48)
                != Some(&1),
            OpenFundsError::CampaignClosed
        );
        require!(amount_lamports > 0, OpenFundsError::ZeroContribution);
        let campaign_key = ctx.accounts.campaign.key();
        let backer_key = ctx.accounts.backer.key();
        let contribution = &mut ctx.accounts.contribution;

        // Only freshly initialized, zeroed state may receive its identities.
        // Legacy closure only appends a flag; contribution identities are never reset.
        if contribution.campaign == Pubkey::default() {
            require!(
                contribution.backer == Pubkey::default() && contribution.total_contributed == 0,
                OpenFundsError::InvalidContribution
            );
            contribution.campaign = campaign_key;
            contribution.backer = backer_key;
        }
        require_keys_eq!(
            contribution.campaign,
            campaign_key,
            OpenFundsError::InvalidContribution
        );
        require_keys_eq!(
            contribution.backer,
            backer_key,
            OpenFundsError::InvalidContribution
        );

        let campaign_total = ctx
            .accounts
            .campaign
            .total_contributed
            .checked_add(amount_lamports)
            .ok_or(OpenFundsError::Overflow)?;
        let backer_total = contribution
            .total_contributed
            .checked_add(amount_lamports)
            .ok_or(OpenFundsError::Overflow)?;

        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                Transfer {
                    from: ctx.accounts.backer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount_lamports,
        )?;
        ctx.accounts.campaign.total_contributed = campaign_total;
        contribution.total_contributed = backer_total;
        Ok(())
    }
    pub fn initialize_platform_v2(ctx: Context<InitializePlatformV2>) -> Result<()> {
        ctx.accounts.platform.version = 2;
        Ok(())
    }

    pub fn initialize_campaign_v2(
        ctx: Context<InitializeCampaignV2>,
        campaign_id: u64,
        goal_lamports: u64,
        title: String,
        description: String,
        image_url: String,
    ) -> Result<()> {
        require!(goal_lamports > 0, OpenFundsError::InvalidGoal);
        require!(
            !title.trim().is_empty()
                && title.len() <= CampaignV2::MAX_TITLE
                && !description.trim().is_empty()
                && description.len() <= CampaignV2::MAX_DESCRIPTION
                && image_url.len() <= CampaignV2::MAX_IMAGE_URL
                && (image_url.is_empty() || image_url.starts_with("https://")),
            OpenFundsError::InvalidMetadata
        );
        let campaign = &mut ctx.accounts.campaign;
        campaign.creator = ctx.accounts.creator.key();
        campaign.campaign_id = campaign_id;
        campaign.goal_lamports = goal_lamports;
        campaign.total_contributed = 0;
        campaign.total_refunded = 0;
        campaign.message_count = 0;
        campaign.created_at = Clock::get()?.unix_timestamp;
        campaign.closed_at = 0;
        campaign.status = CampaignV2::OPEN;
        campaign.title = title;
        campaign.description = description;
        campaign.image_url = image_url;
        Ok(())
    }

    pub fn contribute_v2(ctx: Context<ContributeV2>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, OpenFundsError::ZeroContribution);
        require!(
            ctx.accounts.campaign.status == CampaignV2::OPEN,
            OpenFundsError::CampaignClosed
        );
        let campaign_key = ctx.accounts.campaign.key();
        let backer_key = ctx.accounts.backer.key();
        let contribution = &mut ctx.accounts.contribution;
        if contribution.campaign == Pubkey::default() {
            require!(
                contribution.backer == Pubkey::default()
                    && contribution.total_contributed == 0
                    && contribution.total_refunded == 0,
                OpenFundsError::InvalidContribution
            );
            contribution.campaign = campaign_key;
            contribution.backer = backer_key;
        }
        require_keys_eq!(
            contribution.campaign,
            campaign_key,
            OpenFundsError::InvalidContribution
        );
        require_keys_eq!(
            contribution.backer,
            backer_key,
            OpenFundsError::InvalidContribution
        );
        let campaign_total = ctx
            .accounts
            .campaign
            .total_contributed
            .checked_add(amount_lamports)
            .ok_or(OpenFundsError::Overflow)?;
        let backer_total = contribution
            .total_contributed
            .checked_add(amount_lamports)
            .ok_or(OpenFundsError::Overflow)?;
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                Transfer {
                    from: ctx.accounts.backer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount_lamports,
        )?;
        ctx.accounts.campaign.total_contributed = campaign_total;
        contribution.total_contributed = backer_total;
        Ok(())
    }

    pub fn close_campaign_v2(ctx: Context<CloseCampaignV2>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        require!(
            campaign.status == CampaignV2::OPEN,
            OpenFundsError::CampaignClosed
        );
        campaign.closed_at = Clock::get()?.unix_timestamp;
        campaign.status = if campaign.total_contributed == 0 {
            CampaignV2::REFUNDED
        } else {
            CampaignV2::REFUNDING
        };
        Ok(())
    }

    pub fn refund_contribution_v2(ctx: Context<RefundContributionV2>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let contribution = &mut ctx.accounts.contribution;
        require!(
            campaign.status != CampaignV2::OPEN,
            OpenFundsError::RefundNotStarted
        );
        require!(
            ctx.accounts.authority.key() == campaign.creator
                || ctx.accounts.authority.key() == contribution.backer,
            OpenFundsError::Unauthorized
        );
        let amount = contribution
            .total_contributed
            .checked_sub(contribution.total_refunded)
            .ok_or(OpenFundsError::InvalidContribution)?;
        require!(amount > 0, OpenFundsError::AlreadyRefunded);
        let refunded_total = campaign
            .total_refunded
            .checked_add(amount)
            .ok_or(OpenFundsError::Overflow)?;
        require!(
            refunded_total <= campaign.total_contributed,
            OpenFundsError::InvalidContribution
        );
        let reserve = Rent::get()?.minimum_balance(8);
        require!(
            ctx.accounts
                .vault
                .get_lamports()
                .checked_sub(amount)
                .is_some_and(|remaining| remaining >= reserve),
            OpenFundsError::InvalidVaultBalance
        );
        ctx.accounts.vault.sub_lamports(amount)?;
        ctx.accounts.backer.add_lamports(amount)?;
        contribution.total_refunded = contribution.total_contributed;
        campaign.total_refunded = refunded_total;
        if refunded_total == campaign.total_contributed {
            campaign.status = CampaignV2::REFUNDED;
        }
        Ok(())
    }

    pub fn post_message_v2(
        ctx: Context<PostMessageV2>,
        message_index: u64,
        body: String,
    ) -> Result<()> {
        require!(
            ctx.accounts.campaign.status == CampaignV2::OPEN,
            OpenFundsError::CampaignClosed
        );
        require!(
            !body.trim().is_empty() && body.len() <= MessageV2::MAX_BODY,
            OpenFundsError::InvalidMessage
        );
        require!(
            message_index == ctx.accounts.campaign.message_count,
            OpenFundsError::InvalidMessageIndex
        );
        if ctx.accounts.author.key() != ctx.accounts.campaign.creator {
            require_keys_eq!(
                *ctx.accounts.author_contribution.owner,
                crate::ID,
                OpenFundsError::Unauthorized
            );
            let info = ctx.accounts.author_contribution.to_account_info();
            let data = info.try_borrow_data()?;
            let contribution = ContributionV2::try_deserialize(&mut data.as_ref())
                .map_err(|_| error!(OpenFundsError::Unauthorized))?;
            require_keys_eq!(
                contribution.campaign,
                ctx.accounts.campaign.key(),
                OpenFundsError::Unauthorized
            );
            require_keys_eq!(
                contribution.backer,
                ctx.accounts.author.key(),
                OpenFundsError::Unauthorized
            );
            require!(
                contribution.total_contributed > 0,
                OpenFundsError::Unauthorized
            );
        }
        let next = ctx
            .accounts
            .campaign
            .message_count
            .checked_add(1)
            .ok_or(OpenFundsError::Overflow)?;
        let message = &mut ctx.accounts.message;
        message.campaign = ctx.accounts.campaign.key();
        message.author = ctx.accounts.author.key();
        message.message_index = message_index;
        message.created_at = Clock::get()?.unix_timestamp;
        message.body = body;
        ctx.accounts.campaign.message_count = next;
        Ok(())
    }

    pub fn post_message_legacy(
        ctx: Context<PostMessageLegacy>,
        message_index: u64,
        body: String,
    ) -> Result<()> {
        require!(
            ctx.accounts
                .campaign
                .to_account_info()
                .try_borrow_data()?
                .get(48)
                != Some(&1),
            OpenFundsError::CampaignClosed
        );
        require!(
            !body.trim().is_empty() && body.len() <= MessageV2::MAX_BODY,
            OpenFundsError::InvalidMessage
        );
        let discussion = &mut ctx.accounts.discussion;
        if discussion.campaign == Pubkey::default() {
            require!(
                discussion.message_count == 0,
                OpenFundsError::InvalidMessageIndex
            );
            discussion.campaign = ctx.accounts.campaign.key();
        }
        require_keys_eq!(
            discussion.campaign,
            ctx.accounts.campaign.key(),
            OpenFundsError::Unauthorized
        );
        require!(
            message_index == discussion.message_count,
            OpenFundsError::InvalidMessageIndex
        );
        if ctx.accounts.author.key() != ctx.accounts.campaign.creator {
            require_keys_eq!(
                *ctx.accounts.author_contribution.owner,
                crate::ID,
                OpenFundsError::Unauthorized
            );
            let info = ctx.accounts.author_contribution.to_account_info();
            let data = info.try_borrow_data()?;
            let contribution = Contribution::try_deserialize(&mut data.as_ref())
                .map_err(|_| error!(OpenFundsError::Unauthorized))?;
            require_keys_eq!(
                contribution.campaign,
                ctx.accounts.campaign.key(),
                OpenFundsError::Unauthorized
            );
            require_keys_eq!(
                contribution.backer,
                ctx.accounts.author.key(),
                OpenFundsError::Unauthorized
            );
            require!(
                contribution.total_contributed > 0,
                OpenFundsError::Unauthorized
            );
        }
        let next = discussion
            .message_count
            .checked_add(1)
            .ok_or(OpenFundsError::Overflow)?;
        let message = &mut ctx.accounts.message;
        message.campaign = ctx.accounts.campaign.key();
        message.author = ctx.accounts.author.key();
        message.message_index = message_index;
        message.created_at = Clock::get()?.unix_timestamp;
        message.body = body;
        discussion.message_count = next;
        Ok(())
    }

    pub fn close_campaign_legacy(ctx: Context<CloseCampaignLegacy>) -> Result<()> {
        ctx.accounts
            .campaign
            .to_account_info()
            .try_borrow_mut_data()?[48] = 1;
        let closure = &mut ctx.accounts.closure;
        closure.campaign = ctx.accounts.campaign.key();
        closure.creator = ctx.accounts.creator.key();
        closure.total_refunded = 0;
        closure.status = if ctx.accounts.campaign.total_contributed == 0 {
            2
        } else {
            1
        };
        closure.closed_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn refund_contribution_legacy(ctx: Context<RefundContributionLegacy>) -> Result<()> {
        require!(
            ctx.accounts
                .campaign
                .to_account_info()
                .try_borrow_data()?
                .get(48)
                == Some(&1),
            OpenFundsError::RefundNotStarted
        );
        require!(
            ctx.accounts.authority.key() == ctx.accounts.campaign.creator
                || ctx.accounts.authority.key() == ctx.accounts.contribution.backer,
            OpenFundsError::Unauthorized
        );
        let receipt = &mut ctx.accounts.receipt;
        if receipt.campaign == Pubkey::default() {
            require!(
                receipt.backer == Pubkey::default() && receipt.total_refunded == 0,
                OpenFundsError::InvalidContribution
            );
            receipt.campaign = ctx.accounts.campaign.key();
            receipt.backer = ctx.accounts.backer.key();
        }
        require_keys_eq!(
            receipt.campaign,
            ctx.accounts.campaign.key(),
            OpenFundsError::InvalidContribution
        );
        require_keys_eq!(
            receipt.backer,
            ctx.accounts.backer.key(),
            OpenFundsError::InvalidContribution
        );
        let amount = ctx
            .accounts
            .contribution
            .total_contributed
            .checked_sub(receipt.total_refunded)
            .ok_or(OpenFundsError::InvalidContribution)?;
        require!(amount > 0, OpenFundsError::AlreadyRefunded);
        let refunded_total = ctx
            .accounts
            .closure
            .total_refunded
            .checked_add(amount)
            .ok_or(OpenFundsError::Overflow)?;
        require!(
            refunded_total <= ctx.accounts.campaign.total_contributed,
            OpenFundsError::InvalidContribution
        );
        let reserve = Rent::get()?.minimum_balance(8);
        require!(
            ctx.accounts
                .vault
                .get_lamports()
                .checked_sub(amount)
                .is_some_and(|remaining| remaining >= reserve),
            OpenFundsError::InvalidVaultBalance
        );
        ctx.accounts.vault.sub_lamports(amount)?;
        ctx.accounts.backer.add_lamports(amount)?;
        receipt.total_refunded = ctx.accounts.contribution.total_contributed;
        ctx.accounts.closure.total_refunded = refunded_total;
        if refunded_total == ctx.accounts.campaign.total_contributed {
            ctx.accounts.closure.status = 2;
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer = creator, space = 48,
        seeds = [b"campaign", creator.key().as_ref()], bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(init, payer = creator, space = 8,
        seeds = [b"vault", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,
    #[account(mut, seeds = [b"campaign", campaign.creator.as_ref()], bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(mut, seeds = [b"vault", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(init_if_needed, payer = backer, space = 80,
        seeds = [b"contribution", campaign.key().as_ref(), backer.key().as_ref()], bump)]
    pub contribution: Account<'info, Contribution>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Campaign {
    pub creator: Pubkey,
    pub total_contributed: u64,
}

#[account]
pub struct Vault {}

#[account]
pub struct Contribution {
    pub campaign: Pubkey,
    pub backer: Pubkey,
    pub total_contributed: u64,
}

#[error_code]
pub enum OpenFundsError {
    #[msg("Contribution must be greater than zero")]
    ZeroContribution,
    #[msg("Contribution identities must match the campaign and backer")]
    InvalidContribution,
    #[msg("Contribution total overflow")]
    Overflow,
    #[msg("Funding goal must be greater than zero")]
    InvalidGoal,
    #[msg("Project metadata exceeds its bounds or is invalid")]
    InvalidMetadata,
    #[msg("Project is closed to new contributions")]
    CampaignClosed,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Project must be closed before refunds")]
    RefundNotStarted,
    #[msg("This contribution has already been refunded")]
    AlreadyRefunded,
    #[msg("Message must contain text and fit within 240 UTF-8 bytes")]
    InvalidMessage,
    #[msg("Message index must match the next project message")]
    InvalidMessageIndex,
    #[msg("Vault funds must cover the refund and preserve storage rent")]
    InvalidVaultBalance,
}

#[derive(Accounts)]
pub struct InitializePlatformV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 9, seeds = [b"platform_v2"], bump)]
    pub platform: Account<'info, PlatformV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct InitializeCampaignV2<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer = creator, space = CampaignV2::SPACE,
        seeds = [b"campaign_v2", creator.key().as_ref(), campaign_id.to_le_bytes().as_ref()], bump)]
    pub campaign: Account<'info, CampaignV2>,
    #[account(init, payer = creator, space = 8,
        seeds = [b"vault_v2", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, VaultV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ContributeV2<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,
    #[account(mut, seeds = [b"campaign_v2", campaign.creator.as_ref(), campaign.campaign_id.to_le_bytes().as_ref()], bump)]
    pub campaign: Account<'info, CampaignV2>,
    #[account(mut, seeds = [b"vault_v2", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, VaultV2>,
    #[account(init_if_needed, payer = backer, space = 88,
        seeds = [b"contribution_v2", campaign.key().as_ref(), backer.key().as_ref()], bump)]
    pub contribution: Account<'info, ContributionV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseCampaignV2<'info> {
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator @ OpenFundsError::Unauthorized,
        seeds = [b"campaign_v2", campaign.creator.as_ref(), campaign.campaign_id.to_le_bytes().as_ref()], bump)]
    pub campaign: Account<'info, CampaignV2>,
}

#[derive(Accounts)]
pub struct RefundContributionV2<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"campaign_v2", campaign.creator.as_ref(), campaign.campaign_id.to_le_bytes().as_ref()], bump)]
    pub campaign: Account<'info, CampaignV2>,
    #[account(mut, seeds = [b"vault_v2", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, VaultV2>,
    #[account(mut, has_one = campaign @ OpenFundsError::InvalidContribution,
        has_one = backer @ OpenFundsError::InvalidContribution,
        seeds = [b"contribution_v2", campaign.key().as_ref(), backer.key().as_ref()], bump)]
    pub contribution: Account<'info, ContributionV2>,
    /// CHECK: The recorded backer is the only refund recipient. No signature is needed to receive funds.
    #[account(mut)]
    pub backer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(message_index: u64)]
pub struct PostMessageV2<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(mut, seeds = [b"campaign_v2", campaign.creator.as_ref(), campaign.campaign_id.to_le_bytes().as_ref()], bump)]
    pub campaign: Account<'info, CampaignV2>,
    /// CHECK: Canonical PDA is enforced here, then owner and ContributionV2 identities are verified in the handler for backers.
    #[account(seeds = [b"contribution_v2", campaign.key().as_ref(), author.key().as_ref()], bump)]
    pub author_contribution: UncheckedAccount<'info>,
    #[account(init, payer = author, space = MessageV2::SPACE,
        seeds = [b"message_v2", campaign.key().as_ref(), message_index.to_le_bytes().as_ref()], bump)]
    pub message: Account<'info, MessageV2>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct PlatformV2 {
    pub version: u8,
}

#[account]
pub struct CampaignV2 {
    pub creator: Pubkey,
    pub campaign_id: u64,
    pub goal_lamports: u64,
    pub total_contributed: u64,
    pub total_refunded: u64,
    pub message_count: u64,
    pub created_at: i64,
    pub closed_at: i64,
    pub status: u8,
    pub title: String,
    pub description: String,
    pub image_url: String,
}

impl CampaignV2 {
    pub const MAX_TITLE: usize = 80;
    pub const MAX_DESCRIPTION: usize = 400;
    pub const MAX_IMAGE_URL: usize = 200;
    pub const SPACE: usize =
        8 + 32 + 7 * 8 + 1 + 3 * 4 + Self::MAX_TITLE + Self::MAX_DESCRIPTION + Self::MAX_IMAGE_URL;
    pub const OPEN: u8 = 0;
    pub const REFUNDING: u8 = 1;
    pub const REFUNDED: u8 = 2;
}

#[account]
pub struct VaultV2 {}

#[account]
pub struct ContributionV2 {
    pub campaign: Pubkey,
    pub backer: Pubkey,
    pub total_contributed: u64,
    pub total_refunded: u64,
}

#[account]
pub struct MessageV2 {
    pub campaign: Pubkey,
    pub author: Pubkey,
    pub message_index: u64,
    pub created_at: i64,
    pub body: String,
}

impl MessageV2 {
    pub const MAX_BODY: usize = 240;
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 4 + Self::MAX_BODY;
}

#[derive(Accounts)]
pub struct CloseCampaignLegacy<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator @ OpenFundsError::Unauthorized,
        seeds = [b"campaign", campaign.creator.as_ref()], bump,
        realloc = 49, realloc::payer = creator, realloc::zero = true)]
    pub campaign: Account<'info, Campaign>,
    #[account(seeds = [b"vault", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(init, payer = creator, space = 89,
        seeds = [b"legacy_close", campaign.key().as_ref()], bump)]
    pub closure: Account<'info, LegacyClosure>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundContributionLegacy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"campaign", campaign.creator.as_ref()], bump)]
    pub campaign: Account<'info, Campaign>,
    #[account(mut, seeds = [b"vault", campaign.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(has_one = campaign @ OpenFundsError::InvalidContribution,
        has_one = backer @ OpenFundsError::InvalidContribution,
        seeds = [b"contribution", campaign.key().as_ref(), backer.key().as_ref()], bump)]
    pub contribution: Account<'info, Contribution>,
    #[account(mut, has_one = campaign @ OpenFundsError::InvalidContribution,
        constraint = closure.creator == campaign.creator @ OpenFundsError::Unauthorized,
        seeds = [b"legacy_close", campaign.key().as_ref()], bump)]
    pub closure: Account<'info, LegacyClosure>,
    #[account(init_if_needed, payer = authority, space = 80,
        seeds = [b"legacy_refund", campaign.key().as_ref(), backer.key().as_ref()], bump)]
    pub receipt: Account<'info, LegacyRefundReceipt>,
    /// CHECK: Canonical Contribution account binds the only permitted recipient.
    #[account(mut)]
    pub backer: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct LegacyClosure {
    pub campaign: Pubkey,
    pub creator: Pubkey,
    pub total_refunded: u64,
    pub status: u8,
    pub closed_at: i64,
}

#[account]
pub struct LegacyRefundReceipt {
    pub campaign: Pubkey,
    pub backer: Pubkey,
    pub total_refunded: u64,
}

#[derive(Accounts)]
#[instruction(message_index: u64)]
pub struct PostMessageLegacy<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(seeds = [b"campaign", campaign.creator.as_ref()], bump)]
    pub campaign: Account<'info, Campaign>,
    /// CHECK: Canonical PDA and handler verify the recorded legacy backer for non-creators.
    #[account(seeds = [b"contribution", campaign.key().as_ref(), author.key().as_ref()], bump)]
    pub author_contribution: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = author, space = 48,
        seeds = [b"legacy_discussion", campaign.key().as_ref()], bump)]
    pub discussion: Account<'info, LegacyDiscussion>,
    #[account(init, payer = author, space = MessageV2::SPACE,
        seeds = [b"message_v2", campaign.key().as_ref(), message_index.to_le_bytes().as_ref()], bump)]
    pub message: Account<'info, MessageV2>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct LegacyDiscussion {
    pub campaign: Pubkey,
    pub message_count: u64,
}
