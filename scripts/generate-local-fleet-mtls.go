package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

const outputDir = ".temp/fleet-mtls"

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go run scripts/generate-local-fleet-mtls.go <fleet-server-certificate.pem>")
		os.Exit(2)
	}

	if err := generate(os.Args[1]); err != nil {
		fmt.Fprintf(os.Stderr, "local Fleet mTLS setup failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Local Fleet mTLS files are ready in %s\n", outputDir)
}

func generate(serverCertificatePath string) error {
	serverPEM, err := os.ReadFile(serverCertificatePath)
	if err != nil {
		return fmt.Errorf("read Fleet server certificate: %w", err)
	}
	serverCertificate, err := parseCertificate(serverPEM)
	if err != nil {
		return fmt.Errorf("parse Fleet server certificate: %w", err)
	}
	if !serverCertificate.IsCA || serverCertificate.VerifyHostname("fleet-manager") != nil ||
		serverCertificate.VerifyHostname(net.IPv4(127, 0, 0, 1).String()) != nil {
		return errors.New("Fleet server certificate must be a CA and cover fleet-manager and 127.0.0.1")
	}

	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return fmt.Errorf("create local certificate directory: %w", err)
	}
	paths := localPaths()
	allPaths := []string{
		paths.caCertificate,
		paths.caKey,
		paths.clientCertificate,
		paths.clientKey,
		paths.serverCertificate,
	}
	existing := 0
	for _, path := range allPaths {
		if _, statErr := os.Stat(path); statErr == nil {
			existing++
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return fmt.Errorf("inspect local certificate file: %w", statErr)
		}
	}
	if existing == len(allPaths) {
		if err := validateExisting(paths, serverPEM); err != nil {
			return err
		}
		return nil
	}
	if existing != 0 {
		return errors.New("partial local mTLS files exist; remove .temp/fleet-mtls after stopping both services, then rerun")
	}

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("generate Core client CA key: %w", err)
	}
	caTemplate := &x509.Certificate{
		SerialNumber:          randomSerial(),
		Subject:               pkix.Name{CommonName: "core-backend-local-ca"},
		NotBefore:             time.Now().Add(-5 * time.Minute),
		NotAfter:              time.Now().AddDate(1, 0, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign |
			x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		return fmt.Errorf("create Core client CA certificate: %w", err)
	}
	if err := writeCertificate(paths.caCertificate, caDER); err != nil {
		return err
	}
	if err := writePrivateKey(paths.caKey, caKey); err != nil {
		return err
	}

	clientKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("generate Core client key: %w", err)
	}
	clientTemplate := &x509.Certificate{
		SerialNumber:          randomSerial(),
		Subject:               pkix.Name{CommonName: "core-backend-local"},
		NotBefore:             time.Now().Add(-5 * time.Minute),
		NotAfter:              time.Now().AddDate(1, 0, 0),
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	clientDER, err := x509.CreateCertificate(rand.Reader, clientTemplate, caTemplate, &clientKey.PublicKey, caKey)
	if err != nil {
		return fmt.Errorf("create Core client certificate: %w", err)
	}
	if err := writeCertificate(paths.clientCertificate, clientDER); err != nil {
		return err
	}
	if err := writePrivateKey(paths.clientKey, clientKey); err != nil {
		return err
	}
	if err := os.WriteFile(paths.serverCertificate, serverPEM, 0600); err != nil {
		return fmt.Errorf("save Fleet server trust certificate: %w", err)
	}
	return nil
}

type certificatePaths struct {
	caCertificate     string
	caKey             string
	clientCertificate string
	clientKey         string
	serverCertificate string
}

func localPaths() certificatePaths {
	return certificatePaths{
		caCertificate:     filepath.Join(outputDir, "core-client-ca.crt"),
		caKey:             filepath.Join(outputDir, "core-client-ca.key"),
		clientCertificate: filepath.Join(outputDir, "core-client.crt"),
		clientKey:         filepath.Join(outputDir, "core-client.key"),
		serverCertificate: filepath.Join(outputDir, "fleet-server.crt"),
	}
}

func validateExisting(paths certificatePaths, expectedServerPEM []byte) error {
	readCert := func(path string) (*x509.Certificate, error) {
		contents, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		return parseCertificate(contents)
	}
	ca, err := readCert(paths.caCertificate)
	if err != nil || !ca.IsCA {
		return errors.New("existing Core client CA certificate is invalid")
	}
	caPublicKey, ok := ca.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return errors.New("existing Core client CA certificate is not ECDSA")
	}
	client, err := readCert(paths.clientCertificate)
	if err != nil || client.Subject.CommonName != "core-backend-local" ||
		client.CheckSignatureFrom(ca) != nil {
		return errors.New("existing Core client certificate is invalid")
	}
	clientPublicKey, ok := client.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return errors.New("existing Core client certificate is not ECDSA")
	}
	caKey, err := readPrivateKey(paths.caKey)
	if err != nil || !caPublicKey.Equal(&caKey.PublicKey) {
		return errors.New("existing Core client CA key does not match its certificate")
	}
	clientKey, err := readPrivateKey(paths.clientKey)
	if err != nil || !clientPublicKey.Equal(&clientKey.PublicKey) {
		return errors.New("existing Core client key does not match its certificate")
	}
	serverPEM, err := os.ReadFile(paths.serverCertificate)
	if err != nil || string(serverPEM) != string(expectedServerPEM) {
		return errors.New("existing Fleet server trust certificate differs from the supplied certificate")
	}
	return nil
}

func parseCertificate(contents []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(contents)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("invalid PEM certificate")
	}
	return x509.ParseCertificate(block.Bytes)
}

func readPrivateKey(path string) (*ecdsa.PrivateKey, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(contents)
	if block == nil {
		return nil, errors.New("invalid PEM private key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	ecdsaKey, ok := key.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not ECDSA")
	}
	return ecdsaKey, nil
}

func writeCertificate(path string, der []byte) error {
	contents := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(path, contents, 0600); err != nil {
		return fmt.Errorf("write local certificate: %w", err)
	}
	return nil
}

func writePrivateKey(path string, key *ecdsa.PrivateKey) error {
	contents, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return fmt.Errorf("encode local private key: %w", err)
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: contents}), 0600); err != nil {
		return fmt.Errorf("write local private key: %w", err)
	}
	return nil
}

func randomSerial() *big.Int {
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		panic(err)
	}
	return serial
}
