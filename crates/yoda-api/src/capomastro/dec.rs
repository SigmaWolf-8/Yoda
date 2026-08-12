//! Exact base-10 decimal arithmetic for the sovereign ledger.
//!
//! Money in this estate is published to the cent and audited against a
//! workbook. Binary floating point cannot represent most decimal cents, so a
//! single `f64` multiplication is enough to turn `1250000000.05` into
//! `1250000000.0499999523` and put a signed statement out by a penny. Every
//! figure that reaches an auditor therefore moves through this type, which
//! holds an integer number of units together with the power of ten that scales
//! them, and never touches a float.
//!
//! Arithmetic is checked rather than wrapping: an overflow on a balance sheet
//! must surface as a refusal to answer, not as a silently wrong total. The
//! ledger's largest figure is ~2.15e12 and the working scale is 12 digits,
//! giving ~2.15e24 units against `i128`'s ~1.7e38 ceiling — comfortable for
//! sums, and guarded by `checked_mul` for products.

use std::cmp::Ordering;
use std::fmt;

/// Digits kept after the point for intermediate results (rates, day-count
/// fractions, ratios). Products are rescaled back to this to stop scale
/// creeping upward until it overflows.
pub const WORKING_SCALE: u32 = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecError(pub String);

impl fmt::Display for DecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DecError {}

/// A signed decimal: `units * 10^-scale`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dec {
    units: i128,
    scale: u32,
}

impl Dec {
    pub const fn zero() -> Self {
        Dec { units: 0, scale: 0 }
    }

    pub const fn from_units(units: i128, scale: u32) -> Self {
        Dec { units, scale }
    }

    pub const fn from_int(v: i64) -> Self {
        Dec { units: v as i128, scale: 0 }
    }

    pub fn is_zero(&self) -> bool {
        self.units == 0
    }

    pub fn is_negative(&self) -> bool {
        self.units < 0
    }

    pub fn scale(&self) -> u32 {
        self.scale
    }

    /// Parse a decimal string. Accepts an optional sign, digits, an optional
    /// fractional part, and surrounding whitespace. Rejects exponent notation
    /// and thousands separators outright rather than guessing what was meant —
    /// a misread figure is worse than a failed request.
    pub fn parse(s: &str) -> Result<Self, DecError> {
        let t = s.trim();
        if t.is_empty() {
            return Err(DecError("empty decimal string".into()));
        }
        let (neg, body) = match t.as_bytes()[0] {
            b'-' => (true, &t[1..]),
            b'+' => (false, &t[1..]),
            _ => (false, t),
        };
        if body.is_empty() {
            return Err(DecError(format!("`{s}` is a sign with no digits")));
        }
        let mut parts = body.splitn(2, '.');
        let int_part = parts.next().unwrap_or("");
        let frac_part = parts.next().unwrap_or("");
        if body.matches('.').count() > 1 {
            return Err(DecError(format!("`{s}` has more than one decimal point")));
        }
        if int_part.is_empty() && frac_part.is_empty() {
            return Err(DecError(format!("`{s}` has no digits")));
        }
        for (name, seg) in [("integer", int_part), ("fractional", frac_part)] {
            if !seg.bytes().all(|b| b.is_ascii_digit()) {
                return Err(DecError(format!(
                    "`{s}` has a non-digit in its {name} part (exponents and separators are not accepted)"
                )));
            }
        }
        let scale = u32::try_from(frac_part.len())
            .map_err(|_| DecError(format!("`{s}` has an absurd number of decimal places")))?;
        let digits = format!("{int_part}{frac_part}");
        let mag: i128 = if digits.is_empty() {
            0
        } else {
            digits
                .parse()
                .map_err(|_| DecError(format!("`{s}` does not fit in 128-bit fixed point")))?
        };
        Ok(Dec { units: if neg { -mag } else { mag }, scale })
    }

    fn pow10(n: u32) -> Result<i128, DecError> {
        10i128
            .checked_pow(n)
            .ok_or_else(|| DecError(format!("scale 10^{n} overflows 128-bit fixed point")))
    }

    /// Re-express at a different scale. Growing the scale is exact; shrinking
    /// it rounds half away from zero, the convention auditors expect for
    /// currency.
    pub fn rescale(&self, to: u32) -> Result<Self, DecError> {
        if to == self.scale {
            return Ok(*self);
        }
        if to > self.scale {
            let factor = Self::pow10(to - self.scale)?;
            let units = self
                .units
                .checked_mul(factor)
                .ok_or_else(|| DecError("overflow widening decimal scale".into()))?;
            return Ok(Dec { units, scale: to });
        }
        let factor = Self::pow10(self.scale - to)?;
        let q = self.units / factor;
        let r = (self.units % factor).abs();
        let bump = if r * 2 >= factor { if self.units < 0 { -1 } else { 1 } } else { 0 };
        Ok(Dec { units: q + bump, scale: to })
    }

    fn align(a: &Dec, b: &Dec) -> Result<(i128, i128, u32), DecError> {
        let scale = a.scale.max(b.scale);
        Ok((a.rescale(scale)?.units, b.rescale(scale)?.units, scale))
    }

    pub fn add(&self, other: &Dec) -> Result<Dec, DecError> {
        let (x, y, scale) = Self::align(self, other)?;
        let units = x
            .checked_add(y)
            .ok_or_else(|| DecError("overflow adding decimals".into()))?;
        Ok(Dec { units, scale })
    }

    pub fn sub(&self, other: &Dec) -> Result<Dec, DecError> {
        let (x, y, scale) = Self::align(self, other)?;
        let units = x
            .checked_sub(y)
            .ok_or_else(|| DecError("overflow subtracting decimals".into()))?;
        Ok(Dec { units, scale })
    }

    pub fn neg(&self) -> Dec {
        Dec { units: -self.units, scale: self.scale }
    }

    /// Exact product, then trimmed back to the working scale so repeated
    /// multiplication cannot inflate the scale until it overflows.
    pub fn mul(&self, other: &Dec) -> Result<Dec, DecError> {
        let units = self
            .units
            .checked_mul(other.units)
            .ok_or_else(|| DecError("overflow multiplying decimals".into()))?;
        let raw = Dec { units, scale: self.scale + other.scale };
        if raw.scale > WORKING_SCALE {
            raw.rescale(WORKING_SCALE)
        } else {
            Ok(raw)
        }
    }

    /// Quotient at an explicit scale, rounded half away from zero. The caller
    /// must state the scale: silently picking one is how precision is lost.
    pub fn div(&self, other: &Dec, scale: u32) -> Result<Dec, DecError> {
        if other.units == 0 {
            return Err(DecError("division by zero".into()));
        }
        // numerator * 10^(scale + other.scale - self.scale) / other.units,
        // computed with one extra digit so the final step can round.
        let shift = i64::from(scale) + i64::from(other.scale) - i64::from(self.scale) + 1;
        let (num, den) = if shift >= 0 {
            let factor = Self::pow10(u32::try_from(shift).map_err(|_| {
                DecError("division scale out of range".into())
            })?)?;
            (
                self.units
                    .checked_mul(factor)
                    .ok_or_else(|| DecError("overflow scaling dividend".into()))?,
                other.units,
            )
        } else {
            let factor = Self::pow10(u32::try_from(-shift).map_err(|_| {
                DecError("division scale out of range".into())
            })?)?;
            (
                self.units,
                other
                    .units
                    .checked_mul(factor)
                    .ok_or_else(|| DecError("overflow scaling divisor".into()))?,
            )
        };
        let extra = Dec { units: num / den, scale: scale + 1 };
        extra.rescale(scale)
    }

    pub fn cmp_dec(&self, other: &Dec) -> Result<Ordering, DecError> {
        let (x, y, _) = Self::align(self, other)?;
        Ok(x.cmp(&y))
    }

    pub fn eq_dec(&self, other: &Dec) -> Result<bool, DecError> {
        Ok(self.cmp_dec(other)? == Ordering::Equal)
    }

    /// Sum a slice, propagating the first arithmetic failure.
    pub fn sum(items: &[Dec]) -> Result<Dec, DecError> {
        let mut acc = Dec::zero();
        for it in items {
            acc = acc.add(it)?;
        }
        Ok(acc)
    }

    /// Render at a fixed number of decimal places — what statements print.
    pub fn to_fixed(&self, places: u32) -> Result<String, DecError> {
        Ok(self.rescale(places)?.to_string())
    }

    /// The absolute value, used when splitting a signed balance into the
    /// debit and credit columns of a trial balance.
    pub fn abs(&self) -> Dec {
        Dec { units: self.units.abs(), scale: self.scale }
    }
}

impl fmt::Display for Dec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.scale == 0 {
            return write!(f, "{}", self.units);
        }
        let neg = self.units < 0;
        let mag = self.units.unsigned_abs().to_string();
        let scale = self.scale as usize;
        let (int_part, frac_part) = if mag.len() > scale {
            let split = mag.len() - scale;
            (mag[..split].to_string(), mag[split..].to_string())
        } else {
            ("0".to_string(), format!("{}{}", "0".repeat(scale - mag.len()), mag))
        };
        write!(f, "{}{int_part}.{frac_part}", if neg { "-" } else { "" })
    }
}

impl serde::Serialize for Dec {
    /// Serialised as a JSON *string*. A JSON number would be read back by
    /// every client as an IEEE double, which is precisely the loss this type
    /// exists to prevent.
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_renders_round_trip() {
        for s in ["0", "1250000000.05", "-450000000000", "0.000000000001", "2153000000000"] {
            assert_eq!(Dec::parse(s).unwrap().to_string(), s);
        }
    }

    #[test]
    fn rejects_junk_rather_than_guessing() {
        for s in ["", "1,250", "1e9", "1.2.3", "abc", "-"] {
            assert!(Dec::parse(s).is_err(), "`{s}` should not parse");
        }
    }

    #[test]
    fn cent_arithmetic_is_exact_where_floats_are_not() {
        // 0.1 + 0.2 == 0.3 exactly, unlike f64.
        let sum = Dec::parse("0.1").unwrap().add(&Dec::parse("0.2").unwrap()).unwrap();
        assert_eq!(sum.to_string(), "0.3");
        // The pacs.008 amount that must survive the ledger untouched.
        let amt = Dec::parse("1250000000.05").unwrap();
        assert_eq!(amt.add(&Dec::zero()).unwrap().to_fixed(2).unwrap(), "1250000000.05");
    }

    #[test]
    fn rounds_half_away_from_zero() {
        assert_eq!(Dec::parse("2.345").unwrap().to_fixed(2).unwrap(), "2.35");
        assert_eq!(Dec::parse("-2.345").unwrap().to_fixed(2).unwrap(), "-2.35");
        assert_eq!(Dec::parse("2.344").unwrap().to_fixed(2).unwrap(), "2.34");
    }

    #[test]
    fn day_count_interest_divides_last() {
        // 450,000,000,000 at 3.309% for 130 days on a 365-day basis.
        // 450e9 * 0.03309 = 14,890,500,000; * 130 = 1,935,765,000,000;
        // / 365 = 5,303,465,753.4246…  → 5,303,465,753.42.
        let principal = Dec::parse("450000000000").unwrap();
        let rate = Dec::parse("3.309").unwrap().div(&Dec::from_int(100), 12).unwrap();
        let interest = principal
            .mul(&rate)
            .unwrap()
            .mul(&Dec::from_int(130))
            .unwrap()
            .div(&Dec::from_int(365), 2)
            .unwrap();
        assert_eq!(interest.to_string(), "5303465753.42");
    }

    #[test]
    fn rounding_the_day_count_fraction_first_costs_a_cent() {
        // Why the accrual divides last: pre-rounding 130/365 to twelve places
        // and multiplying pushes the result a cent high. On one obligation
        // that is a cent; across a schedule it is an audit finding.
        let principal = Dec::parse("450000000000").unwrap();
        let rate = Dec::parse("3.309").unwrap().div(&Dec::from_int(100), 12).unwrap();
        let frac = Dec::from_int(130).div(&Dec::from_int(365), 12).unwrap();
        let early = principal.mul(&rate).unwrap().mul(&frac).unwrap().to_fixed(2).unwrap();
        assert_eq!(early, "5303465753.43");
    }

    #[test]
    fn division_by_zero_is_refused() {
        assert!(Dec::parse("1").unwrap().div(&Dec::zero(), 2).is_err());
    }

    #[test]
    fn totals_balance_across_scales() {
        let a = Dec::parse("2153000000000").unwrap();
        let l = Dec::parse("450000000000.00").unwrap();
        let e = Dec::parse("1703000000000.0000").unwrap();
        assert!(l.add(&e).unwrap().eq_dec(&a).unwrap());
    }
}
