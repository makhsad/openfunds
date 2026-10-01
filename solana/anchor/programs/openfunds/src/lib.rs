use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("6NTwPcQMGArcmjStAfica2toF3qqwSD1nsEw2qc1RRHA");

#[program]
pub mod openfunds {
    use super::*;

    pub fn initialize_campaign(ctx: Context<InitializeCampaign>) -> Result<()> {
        ctx.accounts.campaign.creator = ctx.accounts.creator.key();
        ctx.accounts.campaign.total_contributed = 0;
        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, OpenFundsError::ZeroContribution);
        let campaign_key = ctx.accounts.campaign.key();
        let backer_key = ctx.accounts.backer.key();
        let contribution = &mut ctx.accounts.contribution;

        // Only freshly initialized, zeroed state may receive its identities.
        // There is no close, reset, reallocation, or owner-changing instruction.
        if contribution.campaign == Pubkey::default() {
            require!(
                contribution.backer == Pubkey::default()
                    && contribution.total_contributed == 0,
                OpenFundsError::InvalidContribution
            );
            contribution.campaign = campaign_key;
            contribution.backer = backer_key;
        }
        require_keys_eq!(contribution.campaign, campaign_key, OpenFundsError::InvalidContribution);
        require_keys_eq!(contribution.backer, backer_key, OpenFundsError::InvalidContribution);

        let campaign_total = ctx.accounts.campaign.total_contributed
            .checked_add(amount_lamports).ok_or(OpenFundsError::Overflow)?;
        let backer_total = contribution.total_contributed
            .checked_add(amount_lamports).ok_or(OpenFundsError::Overflow)?;

        system_program::transfer(
            CpiContext::new(system_program::ID, Transfer {
                from: ctx.accounts.backer.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            }),
            amount_lamports,
        )?;
        ctx.accounts.campaign.total_contributed = campaign_total;
        contribution.total_contributed = backer_total;
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
}
