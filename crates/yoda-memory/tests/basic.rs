use yoda_memory::*;
use std::sync::Arc;

// ── Trit core ──────────────────────────────────────────────────────

#[test]
fn trit_from_char_ascii() {
    assert_eq!(TritSeq::from_char('A').to_hash_string(), "2102");
}

#[test]
fn trit_from_char_zero() {
    assert_eq!(TritSeq::from_char('\0').to_hash_string(), "0");
}

#[test]
fn trit_add_simple() {
    let one = TritSeq(Box::new([Trit::One]));
    let two = TritSeq(Box::new([Trit::Two]));
    assert_eq!(TritSeq::add(&one, &two).to_hash_string(), "10");
}

#[test]
fn trit_add_carry() {
    let two = TritSeq(Box::new([Trit::Two]));
    assert_eq!(TritSeq::add(&two, &two).to_hash_string(), "11");
}

#[test]
fn trit_ordering() {
    assert!(TritSeq::from_char('A') < TritSeq::from_char('B'));
}

#[test]
fn trit_base27_digits() {
    let d = TritSeq::from_char('A').to_base27_digits();
    assert_eq!(d, vec![2, 11]);
}

// ── Tree (Arc-based, Send + Sync) ──────────────────────────────────

#[test]
fn tree_insert_find() {
    let empty: Arc<Tree<IndexedTritSeq, IndexedTritSeq>> = Tree::empty();
    let k = IndexedTritSeq::from_char('a');
    let v = IndexedTritSeq::from_char('x');
    let tree = empty.insert(k.clone(), v.clone());
    assert_eq!(tree.find(&k).unwrap(), &v);
}

#[test]
fn tree_multiple_inserts() {
    let pairs = vec![('a','x'), ('b','y'), ('c','z'), ('d','w')];
    let mut tree: Arc<Tree<IndexedTritSeq, IndexedTritSeq>> = Tree::empty();
    for &(k, v) in &pairs {
        tree = tree.insert(IndexedTritSeq::from_char(k), IndexedTritSeq::from_char(v));
    }
    for &(k, v) in &pairs {
        assert_eq!(
            tree.find(&IndexedTritSeq::from_char(k)).unwrap(),
            &IndexedTritSeq::from_char(v)
        );
    }
}

#[test]
fn tree_snapshot_isolation() {
    let empty: Arc<Tree<IndexedTritSeq, IndexedTritSeq>> = Tree::empty();
    let k1 = IndexedTritSeq::from_char('a');
    let v1 = IndexedTritSeq::from_char('1');
    let k2 = IndexedTritSeq::from_char('b');
    let v2 = IndexedTritSeq::from_char('2');

    let root_v1 = empty.insert(k1.clone(), v1.clone());
    let root_v2 = root_v1.insert(k2.clone(), v2.clone());

    assert!(root_v1.find(&k2).is_none());
    assert_eq!(root_v2.find(&k2).unwrap(), &v2);
    assert_eq!(root_v1.find(&k1).unwrap(), &v1);
}

#[test]
fn tree_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Arc<Tree<IndexedTritSeq, IndexedTritSeq>>>();
    assert_send_sync::<Arc<Tree<String, String>>>();
}

// ── Isomorphic ─────────────────────────────────────────────────────

#[test]
fn isomorphic_true()       { assert!(is_isomorphic_immutable("egg", "add")); }
#[test]
fn isomorphic_false()      { assert!(!is_isomorphic_immutable("foo", "bar")); }
#[test]
fn isomorphic_unicode()    { assert!(is_isomorphic_immutable("αβα", "γδγ")); }
#[test]
fn isomorphic_empty()      { assert!(is_isomorphic_immutable("", "")); }
#[test]
fn isomorphic_mismatch()   { assert!(!is_isomorphic_immutable("ab", "abc")); }

// ── Cascade layers ─────────────────────────────────────────────────

#[test]
fn layer1_lex() {
    assert_eq!(IndexedTritSeq::from_char('A').lexicographic(), "2102");
}

#[test]
fn layer2_geo_bmp() {
    let idx = IndexedTritSeq::from_char('A');
    let geo = idx.geometrical().unwrap();
    assert_eq!(geo[0].to_hash_string(), "0");
    assert_eq!(geo[1].to_hash_string(), "0");
    assert_eq!(geo[2].to_hash_string(), "2102");
}

#[test]
fn layer2_geo_supplementary() {
    let idx = IndexedTritSeq::from_char('𐀀');
    let geo = idx.geometrical().unwrap();
    assert_eq!(geo[0].to_hash_string(), "1");
    assert_eq!(geo[1].to_hash_string(), "0");
    assert_eq!(geo[2].to_hash_string(), "0");
}

#[test]
fn layer3_algebraic() {
    assert_eq!(IndexedTritSeq::from_char('B').algebraic().to_hash_string(), "2110");
}

#[test]
fn layer4_milesian() {
    assert_eq!(IndexedTritSeq::from_char('A').milesian_value().to_hash_string(), "100");
}

// ── Layer 5: Historical Figures (plenum + explicit) ───────────────

#[test]
fn layer5_hist_plenum_from_char() {
    let idx = IndexedTritSeq::from_char('A');
    let (g, p) = idx.historical_figure().unwrap();
    assert_eq!(g.to_hash_string(), "0");
    assert_eq!(p.to_hash_string(), "0");
}

#[test]
fn layer5_hist_via_new() {
    let trits = TritSeq::from_char('Σ');
    let geo = vec![
        TritSeq(Box::new([Trit::Zero])),
        TritSeq(Box::new([Trit::Zero])),
        TritSeq(Box::new([Trit::Zero])),
    ];
    let group    = TritSeq(Box::new([Trit::One, Trit::Zero])); // 3
    let position = TritSeq(Box::new([Trit::One]));              // 1
    let idx = IndexedTritSeq::new(
        trits, geo,
        TritSeq(Box::new([Trit::One])),
        group, position,
        TritSeq(Box::new([Trit::Zero])),
        "SOCR-001".to_string(),
        TritSeq(Box::new([Trit::One])),
        "philosophy,ethics,ancient".to_string(),
        Vec::new(),
    );
    let (g, p) = idx.historical_figure().unwrap();
    assert_eq!(g.to_hash_string(), "10");
    assert_eq!(p.to_hash_string(), "1");
    assert_eq!(idx.marker_record(), "SOCR-001");
}

#[test]
fn layer6_element_plenum_from_char() {
    assert_eq!(
        IndexedTritSeq::from_char('A').chemical_element().unwrap().to_hash_string(),
        "0"
    );
}

#[test]
fn layer7_marker_bmp() {
    assert_eq!(IndexedTritSeq::from_char('A').marker_record(), "U+0041");
}

#[test]
fn layer7_marker_supplementary() {
    assert_eq!(IndexedTritSeq::from_char('𐀀').marker_record(), "U+010000");
}

#[test]
fn layer8_tier_units() {
    assert_eq!(IndexedTritSeq::from_char('\u{0001}').greek_tier().to_hash_string(), "1");
}

#[test]
fn layer8_tier_tens() {
    let idx = IndexedTritSeq::from_char(char::from_u32(270).unwrap());
    assert_eq!(idx.greek_tier().to_hash_string(), "2");
}

#[test]
fn layer9_oracle() {
    assert_eq!(IndexedTritSeq::from_char('A').alphabetical_oracle(), "P0R0C65");
}

#[test]
fn layer10_manifold_neutral() {
    assert!(IndexedTritSeq::from_char('A').manifold_coords().is_empty());
}

// ── Full cascade ──────────────────────────────────────────────────

#[test]
fn cascade_lex_ordering() {
    assert!(IndexedTritSeq::from_char('A') < IndexedTritSeq::from_char('B'));
}

#[test]
fn avl_keys_with_string_values() {
    // Tree<IndexedTritSeq, String> works because Ord is now a true total
    // order at the type level (plenum architecture, no Option dance).
    let empty: Arc<Tree<IndexedTritSeq, String>> = Tree::empty();
    let t = empty
        .insert(IndexedTritSeq::from_char('A'), "alpha".into())
        .insert(IndexedTritSeq::from_char('B'), "beta".into())
        .insert(IndexedTritSeq::from_char('C'), "gamma".into());
    assert_eq!(t.find(&IndexedTritSeq::from_char('B')).map(String::as_str), Some("beta"));
    assert_eq!(t.find(&IndexedTritSeq::from_char('A')).map(String::as_str), Some("alpha"));
    assert_eq!(t.find(&IndexedTritSeq::from_char('C')).map(String::as_str), Some("gamma"));
}
